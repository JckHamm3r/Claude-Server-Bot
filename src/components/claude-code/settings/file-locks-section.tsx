"use client";

import { useState, useEffect } from "react";
import { Lock, Clock, Trash2, RefreshCw } from "lucide-react";
import { apiUrl } from "@/lib/utils";

interface FileLock {
  file_path: string;
  session_id: string;
  user_email: string;
  tool_name: string;
  tool_call_id: string;
  locked_at: string;
}

interface QueuedOperation {
  id: string;
  file_path: string;
  session_id: string;
  user_email: string;
  tool_name: string;
  queued_at: string;
  status: string;
}

export function FileLockSection() {
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLockData = async () => {
    setLoading(true);
    try {
      const [locksRes, queueRes] = await Promise.all([
        fetch(apiUrl("/api/admin/file-locks")),
        fetch(apiUrl("/api/admin/file-queue")),
      ]);

      if (locksRes.ok) {
        const data = await locksRes.json();
        setLocks(data.locks || []);
      }

      if (queueRes.ok) {
        const data = await queueRes.json();
        setQueue(data.operations || []);
      }
    } catch (err) {
      console.error("Failed to fetch file lock data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLockData();
    const interval = setInterval(fetchLockData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const handleReleaseLock = async (filePath: string) => {
    if (!confirm(`Release lock on ${filePath}?`)) return;

    try {
      const res = await fetch(apiUrl("/api/admin/file-locks/release"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });

      if (res.ok) {
        fetchLockData();
      } else {
        alert("Failed to release lock");
      }
    } catch (err) {
      console.error("Error releasing lock:", err);
      alert("Error releasing lock");
    }
  };

  const formatDuration = (lockedAt: string) => {
    const ms = Date.now() - new Date(lockedAt).getTime();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-bot-text">File Locks & Queue</h2>
        <button
          onClick={fetchLockData}
          className="flex items-center gap-2 rounded-md bg-bot-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Active Locks */}
      <div className="rounded-lg border border-bot-border bg-bot-surface/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 font-medium text-bot-text">
          <Lock className="h-5 w-5" />
          Active Locks ({locks.length})
        </h3>

        {loading ? (
          <div className="py-8 text-center text-sm text-bot-text/60">Loading...</div>
        ) : locks.length === 0 ? (
          <div className="py-8 text-center text-sm text-bot-text/60">No active locks</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-bot-border">
                <tr className="text-left text-bot-text/70">
                  <th className="pb-2 font-medium">File Path</th>
                  <th className="pb-2 font-medium">Session</th>
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Tool</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bot-border/50">
                {locks.map((lock) => (
                  <tr key={lock.file_path} className="text-bot-text">
                    <td className="py-3">
                      <code className="rounded bg-bot-bg px-2 py-1 text-xs">{lock.file_path}</code>
                    </td>
                    <td className="py-3">
                      <code className="text-xs">{lock.session_id.slice(0, 8)}</code>
                    </td>
                    <td className="py-3 text-xs">{lock.user_email}</td>
                    <td className="py-3">
                      <span className="rounded bg-bot-accent/20 px-2 py-0.5 text-xs font-mono">
                        {lock.tool_name}
                      </span>
                    </td>
                    <td className="py-3 text-xs text-bot-text/70">{formatDuration(lock.locked_at)}</td>
                    <td className="py-3">
                      <button
                        onClick={() => handleReleaseLock(lock.file_path)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        title="Force release lock"
                      >
                        <Trash2 className="h-3 w-3" />
                        Release
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Queued Operations */}
      <div className="rounded-lg border border-bot-border bg-bot-surface/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 font-medium text-bot-text">
          <Clock className="h-5 w-5" />
          Queued Operations ({queue.length})
        </h3>

        {loading ? (
          <div className="py-8 text-center text-sm text-bot-text/60">Loading...</div>
        ) : queue.length === 0 ? (
          <div className="py-8 text-center text-sm text-bot-text/60">No queued operations</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-bot-border">
                <tr className="text-left text-bot-text/70">
                  <th className="pb-2 font-medium">File Path</th>
                  <th className="pb-2 font-medium">Session</th>
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Tool</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Queued</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bot-border/50">
                {queue.map((op) => (
                  <tr key={op.id} className="text-bot-text">
                    <td className="py-3">
                      <code className="rounded bg-bot-bg px-2 py-1 text-xs">{op.file_path}</code>
                    </td>
                    <td className="py-3">
                      <code className="text-xs">{op.session_id.slice(0, 8)}</code>
                    </td>
                    <td className="py-3 text-xs">{op.user_email}</td>
                    <td className="py-3">
                      <span className="rounded bg-bot-accent/20 px-2 py-0.5 text-xs font-mono">
                        {op.tool_name}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        op.status === "queued" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400" :
                        op.status === "executing" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400" :
                        "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400"
                      }`}>
                        {op.status}
                      </span>
                    </td>
                    <td className="py-3 text-xs text-bot-text/70">
                      {formatDuration(op.queued_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-bot-border/50 bg-bot-surface/30 p-4 text-sm text-bot-text/70">
        <p className="mb-2">
          <strong>Note:</strong> File locks prevent concurrent modifications across sessions. Operations are automatically queued and executed when files become available.
        </p>
        <p>
          Stale locks (older than 5 minutes) are automatically cleaned up every minute.
        </p>
      </div>
    </div>
  );
}
