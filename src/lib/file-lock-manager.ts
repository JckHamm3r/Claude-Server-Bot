/**
 * File Lock Manager
 *
 * Centralized module to manage file locks and operation queues.
 * Prevents concurrent file modifications across sessions.
 */

import { EventEmitter } from "events";
import {
  createFileLock,
  removeFileLock,
  getFileLock,
  getSessionLocks,
  removeStaleLocks,
  createQueuedOperation,
  getNextQueuedOperation,
  updateQueuedOperationStatus,
  getSessionQueuedOps,
  getQueuedOperation,
  cancelQueuedOperation as dbCancelQueuedOperation,
  cancelSessionQueuedOps,
  getQueuePosition,
  getQueueLength,
  type FileLock,
  type QueuedOperation,
} from "./claude-db";
import { extractFilePaths } from "./file-path-extractor";
import { getUser } from "./claude-db";
import { getAppSetting } from "./app-settings";

// Global event emitter for lock events
export const lockEventEmitter = new EventEmitter();

// Cleanup interval (runs periodically to remove stale locks)
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize the file lock manager
 * Starts the cleanup interval
 */
export function initFileLockManager(): void {
  if (cleanupInterval) return; // Already initialized

  const intervalSeconds = parseInt(getAppSetting("file_lock_cleanup_interval_seconds", "60"), 10);
  cleanupInterval = setInterval(() => {
    cleanupStaleLocks();
  }, intervalSeconds * 1000);

  console.log(`[file-lock] Manager initialized (cleanup interval: ${intervalSeconds}s)`);
}

/**
 * Shutdown the file lock manager
 * Stops the cleanup interval
 */
export function shutdownFileLockManager(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("[file-lock] Manager shutdown");
  }
}

/**
 * Check if file locking is enabled
 */
export function isFileLockEnabled(): boolean {
  return getAppSetting("file_lock_enabled", "true") === "true";
}

/**
 * Acquire lock result interface
 */
export interface AcquireLockResult {
  acquired: boolean;
  queuePosition?: number;
  lockedBy?: {
    userEmail: string;
    userName: string;
    sessionId: string;
  };
}

/**
 * Attempt to acquire a lock on a file
 * Returns result indicating if lock was acquired or operation was queued
 */
export async function acquireLock(
  sessionId: string,
  userEmail: string,
  toolName: string,
  toolCallId: string,
  filePath: string
): Promise<AcquireLockResult> {
  // Check if file locking is enabled
  if (!isFileLockEnabled()) {
    return { acquired: true };
  }

  // Try to create the lock
  const lockCreated = createFileLock(sessionId, userEmail, toolName, toolCallId, filePath);

  if (lockCreated) {
    console.log(`[file-lock] Lock acquired: ${filePath} by ${userEmail} (session: ${sessionId})`);
    return { acquired: true };
  }

  // Lock already exists, get the current lock holder
  const existingLock = getFileLock(filePath);
  if (!existingLock) {
    // Race condition: lock was released between our attempt and now
    // Try again
    const retryLock = createFileLock(sessionId, userEmail, toolName, toolCallId, filePath);
    if (retryLock) {
      return { acquired: true };
    }
  }

  // Lock exists, prepare locked by info
  const lockedBy = {
    userEmail: existingLock?.user_email ?? "unknown",
    userName: "Unknown User",
    sessionId: existingLock?.session_id ?? "",
  };

  if (existingLock) {
    const lockHolder = getUser(existingLock.user_email);
    if (lockHolder) {
      lockedBy.userName = `${lockHolder.first_name || ""} ${lockHolder.last_name || ""}`.trim() || lockHolder.email;
    }
  }

  // Get queue position (will be calculated after adding to queue)
  console.log(`[file-lock] Lock denied: ${filePath} locked by ${lockedBy.userEmail}`);

  return {
    acquired: false,
    queuePosition: getQueueLength(filePath) + 1, // Current queue length + this new item
    lockedBy,
  };
}

/**
 * Queue an operation when file is locked
 */
export async function queueOperation(
  sessionId: string,
  userEmail: string,
  toolName: string,
  toolCallId: string,
  toolInput: Record<string, unknown>,
  filePath: string
): Promise<string> {
  const queueId = createQueuedOperation({
    filePath,
    sessionId,
    userEmail,
    toolName,
    toolCallId,
    toolInput: JSON.stringify(toolInput),
  });

  const position = getQueuePosition(filePath, queueId);

  console.log(`[file-lock] Operation queued: ${filePath} by ${userEmail} (position: ${position}, queue ID: ${queueId})`);

  // Emit queue event
  lockEventEmitter.emit("operation_queued", {
    queueId,
    sessionId,
    userEmail,
    filePath,
    toolName,
    toolCallId,
    position,
  });

  return queueId;
}

/**
 * Release a lock and process the next queued operation
 */
export async function releaseLock(filePath: string, toolCallId: string): Promise<void> {
  // Remove the lock
  removeFileLock(filePath, toolCallId);

  console.log(`[file-lock] Lock released: ${filePath} (tool call: ${toolCallId})`);

  // Emit lock released event
  lockEventEmitter.emit("lock_released", {
    filePath,
    toolCallId,
  });

  // Check if there are queued operations for this file
  const nextOp = getNextQueuedOperation(filePath);

  if (nextOp) {
    console.log(`[file-lock] Processing next queued operation for: ${filePath} (queue ID: ${nextOp.id})`);

    // Update status to executing
    updateQueuedOperationStatus(nextOp.id, "executing");

    // Acquire the lock for the queued operation
    const lockAcquired = createFileLock(
      nextOp.session_id,
      nextOp.user_email,
      nextOp.tool_name,
      nextOp.tool_call_id,
      nextOp.file_path
    );

    if (!lockAcquired) {
      // This shouldn't happen, but handle it
      console.error(`[file-lock] Failed to acquire lock for queued operation: ${nextOp.id}`);
      updateQueuedOperationStatus(nextOp.id, "failed", "Failed to acquire lock");
      return;
    }

    // Emit event to execute the queued operation
    lockEventEmitter.emit("queue_executing", {
      queueId: nextOp.id,
      sessionId: nextOp.session_id,
      userEmail: nextOp.user_email,
      filePath: nextOp.file_path,
      toolName: nextOp.tool_name,
      toolCallId: nextOp.tool_call_id,
      toolInput: JSON.parse(nextOp.tool_input),
    });
  }
}

/**
 * Release all locks for a session
 */
export async function releaseAllSessionLocks(sessionId: string): Promise<void> {
  const locks = getSessionLocks(sessionId);

  console.log(`[file-lock] Releasing ${locks.length} lock(s) for session: ${sessionId}`);

  // Release each lock and process queues
  for (const lock of locks) {
    await releaseLock(lock.file_path, lock.tool_call_id);
  }
}

/**
 * Cancel a queued operation
 */
export function cancelQueuedOperation(queueId: string, userEmail: string): boolean {
  const operation = getQueuedOperation(queueId);

  if (!operation) {
    return false;
  }

  // Check if user has permission to cancel (must be the owner or admin)
  if (operation.user_email !== userEmail) {
    const user = getUser(userEmail);
    if (!user?.is_admin) {
      console.log(`[file-lock] User ${userEmail} not authorized to cancel queue ID: ${queueId}`);
      return false;
    }
  }

  const cancelled = dbCancelQueuedOperation(queueId);

  if (cancelled) {
    console.log(`[file-lock] Operation cancelled: ${queueId} by ${userEmail}`);

    // Emit cancellation event
    lockEventEmitter.emit("operation_cancelled", {
      queueId,
      sessionId: operation.session_id,
      userEmail: operation.user_email,
      filePath: operation.file_path,
      toolCallId: operation.tool_call_id,
    });
  }

  return cancelled;
}

/**
 * Cancel all queued operations for a session
 */
export function cancelAllSessionQueuedOps(sessionId: string): void {
  const operations = getSessionQueuedOps(sessionId);
  console.log(`[file-lock] Cancelling ${operations.length} queued operation(s) for session: ${sessionId}`);

  cancelSessionQueuedOps(sessionId);

  // Emit cancellation events
  for (const op of operations) {
    lockEventEmitter.emit("operation_cancelled", {
      queueId: op.id,
      sessionId: op.session_id,
      userEmail: op.user_email,
      filePath: op.file_path,
      toolCallId: op.tool_call_id,
    });
  }
}

/**
 * Get file lock status
 */
export function getFileLockStatus(filePath: string): {
  locked: boolean;
  lock?: FileLock;
  queueLength: number;
} {
  const lock = getFileLock(filePath);
  const queueLength = getQueueLength(filePath);

  return {
    locked: lock !== null,
    lock: lock ?? undefined,
    queueLength,
  };
}

/**
 * Get all queued operations for a session
 */
export function getSessionQueuedOperations(sessionId: string): QueuedOperation[] {
  return getSessionQueuedOps(sessionId);
}

/**
 * Clean up stale locks (called periodically)
 */
export function cleanupStaleLocks(): void {
  const timeoutMinutes = parseInt(getAppSetting("file_lock_timeout_minutes", "5"), 10);
  const staleLocks = removeStaleLocks(timeoutMinutes);

  if (staleLocks.length > 0) {
    console.log(`[file-lock] Cleaned up ${staleLocks.length} stale lock(s)`);

    // Process queues for affected files
    for (const lock of staleLocks) {
      // Don't await here - let them process asynchronously
      releaseLock(lock.file_path, lock.tool_call_id).catch((err) => {
        console.error(`[file-lock] Error processing queue after stale lock cleanup:`, err);
      });
    }
  }
}

/**
 * Extract file paths from tool input and check if any require locking
 */
export function extractFilePathsFromTool(toolName: string, toolInput: Record<string, unknown>): string[] {
  return extractFilePaths(toolName, toolInput);
}
