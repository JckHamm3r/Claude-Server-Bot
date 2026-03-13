"use client";

import { X, FileText, Image as ImageIcon } from "lucide-react";

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl?: string;
  uploading?: boolean;
  uploadId?: string;
  error?: string;
}

interface AttachmentPreviewProps {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mb-2">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="relative group flex items-center gap-2 rounded-lg border border-bot-border bg-bot-elevated px-2 py-1.5 max-w-[200px]"
        >
          {isImage(att.file) && att.previewUrl ? (
            <img
              src={att.previewUrl}
              alt={att.file.name}
              className="h-8 w-8 rounded object-cover shrink-0"
            />
          ) : (
            <div className="h-8 w-8 rounded bg-bot-surface flex items-center justify-center shrink-0">
              {isImage(att.file) ? (
                <ImageIcon className="h-4 w-4 text-bot-muted" />
              ) : (
                <FileText className="h-4 w-4 text-bot-muted" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-bot-text truncate">
              {att.file.name}
            </div>
            <div className="text-[10px] text-bot-muted">
              {formatSize(att.file.size)}
              {att.uploading && <span className="ml-1 text-bot-accent">uploading...</span>}
              {att.error && <span className="ml-1 text-bot-red">{att.error}</span>}
            </div>
          </div>
          <button
            onClick={() => onRemove(att.id)}
            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-bot-elevated border border-bot-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-bot-red hover:text-white hover:border-bot-red"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
