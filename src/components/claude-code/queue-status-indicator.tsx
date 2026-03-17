"use client";

import { useState } from "react";
import { X, Clock, User, File } from "lucide-react";

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

interface QueueStatusIndicatorProps {
  sessionId: string;
  operations: QueuedOperation[];
  onCancel: (queueId: string) => void;
}

export default function QueueStatusIndicator({ operations, onCancel }: QueueStatusIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  const queuedOps = operations.filter((op) => op.status === "queued");

  if (queuedOps.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-yellow-800 dark:text-yellow-200"
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <span>
            {queuedOps.length} operation{queuedOps.length > 1 ? "s" : ""} queued
          </span>
        </div>
        <svg
          className={`h-5 w-5 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-yellow-300 dark:border-yellow-700">
          {queuedOps.map((op) => (
            <div
              key={op.id}
              className="flex items-start justify-between gap-3 border-b border-yellow-200 px-4 py-3 last:border-b-0 dark:border-yellow-800"
            >
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-yellow-900 dark:text-yellow-100">
                  <File className="h-4 w-4" />
                  <span className="truncate font-mono text-xs">{op.file_path}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-300">
                  <span className="rounded bg-yellow-200 px-2 py-0.5 font-mono dark:bg-yellow-800">
                    {op.tool_name}
                  </span>
                  {op.queuePosition && (
                    <span className="text-yellow-600 dark:text-yellow-400">Position: #{op.queuePosition}</span>
                  )}
                </div>
                {op.lockedBy && (
                  <div className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                    <User className="h-3 w-3" />
                    <span>Locked by {op.lockedBy.userName}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => onCancel(op.id)}
                className="mt-1 rounded p-1 text-yellow-600 hover:bg-yellow-200 hover:text-yellow-800 dark:text-yellow-400 dark:hover:bg-yellow-800 dark:hover:text-yellow-200"
                title="Cancel operation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
