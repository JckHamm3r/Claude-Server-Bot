"use client";

import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";

interface NewSessionDialogProps {
  onClose: () => void;
  onCreate: (name: string, skipPermissions: boolean) => void;
}

export function NewSessionDialog({ onClose, onCreate }: NewSessionDialogProps) {
  const [name, setName] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(name.trim(), skipPermissions);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-bot-border bg-bot-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-subtitle font-semibold text-bot-text">New Session</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-bot-muted hover:bg-bot-elevated transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-caption font-medium text-bot-muted">
              Session name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fix fleet data bug"
              className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors"
            />
          </div>

          <div>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={(e) => setSkipPermissions(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-bot-border accent-bot-accent"
              />
              <span className="text-body text-bot-text">
                Skip permissions (--dangerously-skip-permissions)
              </span>
            </label>
            {skipPermissions && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-bot-red/40 bg-bot-red/10 px-3 py-2 text-caption text-bot-red">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Claude will be able to execute any command, read/write any file, and take
                  irreversible actions without confirmation. Use only for trusted tasks.
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-bot-border px-4 py-2 text-body text-bot-muted hover:bg-bot-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
