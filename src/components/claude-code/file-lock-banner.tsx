"use client";

import { AlertCircle, Clock, User, X } from "lucide-react";

interface FileLockBannerProps {
  filePath: string;
  queuePosition: number;
  lockedBy?: {
    userEmail: string;
    userName: string;
  };
  onCancel?: () => void;
}

export default function FileLockBanner({ filePath, queuePosition, lockedBy, onCancel }: FileLockBannerProps) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-yellow-400 bg-yellow-50 p-4 dark:border-yellow-600 dark:bg-yellow-900/20">
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-semibold text-yellow-900 dark:text-yellow-100">File modification queued</h4>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded p-1 text-yellow-600 hover:bg-yellow-200 hover:text-yellow-800 dark:text-yellow-400 dark:hover:bg-yellow-800 dark:hover:text-yellow-200"
              title="Cancel operation"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="space-y-1 text-sm text-yellow-800 dark:text-yellow-200">
          <div className="flex items-center gap-2">
            <span className="font-medium">File:</span>
            <code className="rounded bg-yellow-100 px-2 py-0.5 font-mono text-xs dark:bg-yellow-800">
              {filePath}
            </code>
          </div>
          {lockedBy && (
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span>
                Currently being modified by <strong>{lockedBy.userName}</strong>
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>
              Position in queue: <strong>#{queuePosition}</strong>
            </span>
          </div>
        </div>
        <p className="text-xs text-yellow-700 dark:text-yellow-300">
          Your operation will execute automatically when the file becomes available.
        </p>
      </div>
    </div>
  );
}
