/**
 * File Queue Integration Example
 * 
 * This file demonstrates how to integrate the file lock queue system into the chat interface.
 * Add this code to your ChatTab component or create a wrapper component.
 */

import { useState, useEffect } from "react";
import { getSocket } from "@/lib/socket";
import QueueStatusIndicator from "./queue-status-indicator";
import FileLockBanner from "./file-lock-banner";

interface QueuedOperation {
  id: string;
  file_path: string;
  session_id: string;
  user_email: string;
  tool_name: string;
  tool_call_id: string;
  queued_at: string;
  status: "queued" | "executing" | "completed" | "failed" | "cancelled";
  queuePosition?: number;
  lockedBy?: {
    userEmail: string;
    userName: string;
  };
}

interface FileQueueManagerProps {
  sessionId: string | null;
  children: React.ReactNode;
}

/**
 * Wrapper component that manages file queue state and displays queue indicators
 * 
 * Usage in ChatTab.tsx:
 * 
 * ```tsx
 * <FileQueueManager sessionId={activeSession?.id}>
 *   <MessageList ... />
 *   <TypingIndicator ... />
 *   <ChatInput ... />
 * </FileQueueManager>
 * ```
 */
export function FileQueueManager({ sessionId, children }: FileQueueManagerProps) {
  const [queuedOperations, setQueuedOperations] = useState<QueuedOperation[]>([]);
  const [currentBanner, setCurrentBanner] = useState<QueuedOperation | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const socket = getSocket();

    // Listen for new queued operations
    const handleOperationQueued = (event: {
      sessionId: string;
      queueId: string;
      filePath: string;
      queuePosition: number;
      toolName: string;
      toolCallId: string;
      userEmail: string;
      userName: string;
    }) => {
      if (event.sessionId === sessionId) {
        const newOp: QueuedOperation = {
          id: event.queueId,
          file_path: event.filePath,
          session_id: event.sessionId,
          user_email: event.userEmail,
          tool_name: event.toolName,
          tool_call_id: event.toolCallId,
          queued_at: new Date().toISOString(),
          status: "queued",
          queuePosition: event.queuePosition,
          lockedBy: {
            userEmail: event.userEmail,
            userName: event.userName,
          },
        };

        setQueuedOperations((prev) => [...prev, newOp]);
        setCurrentBanner(newOp);
      }
    };

    // Listen for queue execution (operation is now running)
    const handleQueueExecuting = (event: {
      sessionId: string;
      queueId: string;
      filePath: string;
      toolCallId: string;
    }) => {
      if (event.sessionId === sessionId) {
        setQueuedOperations((prev) =>
          prev.map((op) =>
            op.id === event.queueId ? { ...op, status: "executing" as const } : op
          )
        );
        // Clear banner when operation starts executing
        setCurrentBanner((current) => (current?.id === event.queueId ? null : current));
      }
    };

    // Listen for operation cancellation
    const handleOperationCancelled = (event: {
      sessionId: string;
      queueId: string;
      filePath: string;
      toolCallId: string;
    }) => {
      if (event.sessionId === sessionId) {
        setQueuedOperations((prev) =>
          prev.filter((op) => op.id !== event.queueId)
        );
        setCurrentBanner((current) => (current?.id === event.queueId ? null : current));
      }
    };

    // Listen for lock released (cleanup completed operations)
    const handleLockReleased = (event: {
      filePath: string;
      toolCallId: string;
    }) => {
      setQueuedOperations((prev) =>
        prev.filter((op) => op.tool_call_id !== event.toolCallId)
      );
    };

    socket.on("file:operation_queued", handleOperationQueued);
    socket.on("file:queue_executing", handleQueueExecuting);
    socket.on("file:operation_cancelled", handleOperationCancelled);
    socket.on("file:lock_released", handleLockReleased);

    // Fetch current queue status when mounting
    socket.emit("file:get_queue_status", { sessionId }, (response: { success: boolean; operations?: QueuedOperation[] }) => {
      if (response.success && response.operations) {
        setQueuedOperations(response.operations);
      }
    });

    return () => {
      socket.off("file:operation_queued", handleOperationQueued);
      socket.off("file:queue_executing", handleQueueExecuting);
      socket.off("file:operation_cancelled", handleOperationCancelled);
      socket.off("file:lock_released", handleLockReleased);
    };
  }, [sessionId]);

  const handleCancelOperation = (queueId: string) => {
    const socket = getSocket();
    socket.emit("file:cancel_queued_operation", { queueId });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {children}
      
      {/* Show banner for the most recent queued operation */}
      {currentBanner && (
        <FileLockBanner
          filePath={currentBanner.file_path}
          queuePosition={currentBanner.queuePosition ?? 1}
          lockedBy={currentBanner.lockedBy}
          onCancel={() => handleCancelOperation(currentBanner.id)}
        />
      )}
      
      {/* Show queue indicator above chat input */}
      {sessionId && (
        <QueueStatusIndicator
          sessionId={sessionId}
          operations={queuedOperations}
          onCancel={handleCancelOperation}
        />
      )}
    </div>
  );
}

/**
 * Integration Steps:
 * 
 * 1. Import the FileQueueManager in your ChatTab component
 * 2. Wrap the message list, typing indicator, and chat input with FileQueueManager
 * 3. Pass the active session ID
 * 
 * Example:
 * 
 * ```tsx
 * // In ChatTab.tsx
 * import { FileQueueManager } from "./file-queue-integration";
 * 
 * // In the render section:
 * <div className="flex flex-col flex-1 overflow-hidden">
 *   <FileQueueManager sessionId={activeSession?.id ?? null}>
 *     {activeSession && chat.messages.length > 0 && (
 *       <MessageList ... />
 *     )}
 *     <TypingIndicator typingUsers={chat.typingUsers} />
 *     <ChatInput ... />
 *   </FileQueueManager>
 * </div>
 * ```
 */
