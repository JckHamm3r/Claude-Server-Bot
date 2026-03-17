"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  FilePlus, FolderPlus, Pencil, Trash2, AlertTriangle,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import type { TreeEntry } from "@/app/api/claude-code/files/tree/route";

export type FileAction =
  | { type: "new-file"; parentPath: string }
  | { type: "new-folder"; parentPath: string }
  | { type: "rename"; entry: TreeEntry }
  | { type: "delete"; entry: TreeEntry };

interface FileContextMenuProps {
  x: number;
  y: number;
  target: TreeEntry | null; // null = project root / empty area
  onAction: (action: FileAction) => void;
  onClose: () => void;
}

export function FileContextMenu({ x, y, target, onAction, onClose }: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Adjust position so menu doesn't go off-screen
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    setConfirmDelete(false);
    setDeleting(false);
    setDeleteError(null);

    const el = menuRef.current;
    if (!el) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    setPos({
      x: x + rect.width > vw ? Math.max(0, vw - rect.width - 8) : x,
      y: y + rect.height > vh ? Math.max(0, vh - rect.height - 8) : y,
    });
  }, [x, y]);

  // Close on outside click or Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [onClose]);

  const parentPath = target?.type === "dir" ? target.path : (target ? target.path.split("/").slice(0, -1).join("/") : "");

  const handleDelete = useCallback(async () => {
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(apiUrl("/api/claude-code/files/manage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", path: target.path }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        onAction({ type: "delete", entry: target });
        onClose();
      } else {
        setDeleteError(data.error ?? "Delete failed");
        setDeleting(false);
      }
    } catch (err) {
      setDeleteError(String(err));
      setDeleting(false);
    }
  }, [target, onAction, onClose]);

  const MenuItem = ({
    icon: Icon,
    label,
    onClick,
    destructive,
    disabled,
  }: {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    destructive?: boolean;
    disabled?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-caption transition-colors",
        destructive
          ? "text-bot-red hover:bg-bot-red/10"
          : "text-bot-text/80 hover:bg-bot-elevated/60 hover:text-bot-text",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );

  const content = (
    <div
      ref={menuRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
      className="min-w-[180px] rounded-xl border border-bot-border/40 bg-bot-surface/95 backdrop-blur-md shadow-xl py-1.5 overflow-hidden"
    >
      {!confirmDelete ? (
        <>
          {/* Create actions */}
          <MenuItem
            icon={FilePlus}
            label="New File"
            onClick={() => { onAction({ type: "new-file", parentPath }); onClose(); }}
          />
          <MenuItem
            icon={FolderPlus}
            label="New Folder"
            onClick={() => { onAction({ type: "new-folder", parentPath }); onClose(); }}
          />

          {/* Node-specific actions */}
          {target && (
            <>
              <div className="my-1 border-t border-bot-border/20" />
              <MenuItem
                icon={Pencil}
                label="Rename"
                onClick={() => { onAction({ type: "rename", entry: target }); onClose(); }}
              />
              <MenuItem
                icon={Trash2}
                label="Delete"
                destructive
                onClick={() => setConfirmDelete(true)}
              />
            </>
          )}
        </>
      ) : (
        /* Delete confirmation */
        <div className="px-3 py-2">
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-bot-red shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-caption font-medium text-bot-text">Delete &ldquo;{target?.name}&rdquo;?</p>
              {target?.type === "dir" && (
                <p className="text-[10px] text-bot-muted mt-0.5">This will delete all contents.</p>
              )}
            </div>
          </div>
          {deleteError && (
            <p className="text-[10px] text-bot-red mb-2">{deleteError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
              className="flex-1 rounded-lg border border-bot-border/30 px-3 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-colors"
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 rounded-lg bg-bot-red/15 border border-bot-red/30 px-3 py-1.5 text-caption text-bot-red hover:bg-bot-red/25 transition-colors font-medium disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
