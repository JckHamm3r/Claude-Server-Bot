"use client";

import { useState, useRef } from "react";
import { X, Upload, Link as LinkIcon, Check, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, apiUrl } from "@/lib/utils";

interface ChangeAvatarModalProps {
  open: boolean;
  onClose: () => void;
  currentAvatar: string | null;
  onAvatarChange: (url: string | null) => void;
}

export function ChangeAvatarModal({
  open,
  onClose,
  currentAvatar,
  onAvatarChange,
}: ChangeAvatarModalProps) {
  const [activeTab, setActiveTab] = useState<"upload" | "url">("upload");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError("File size must be less than 2MB");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("File must be an image");
      return;
    }

    setSelectedFile(file);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUrlChange = async (url: string) => {
    setAvatarUrl(url);
    setError(null);
    setPreviewUrl(null);

    if (!url.trim()) return;

    try {
      const img = new Image();
      img.onload = () => {
        setPreviewUrl(url);
        setError(null);
      };
      img.onerror = () => {
        setError("Unable to load image from URL");
        setPreviewUrl(null);
      };
      img.src = url;
    } catch {
      setError("Invalid URL");
    }
  };

  const handleSave = async () => {
    setUploading(true);
    setError(null);
    setSuccess(false);

    try {
      if (activeTab === "upload" && selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);

        const res = await fetch(apiUrl("/api/users/avatar"), {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }

        const data = await res.json();
        onAvatarChange(data.avatarUrl);
        setSuccess(true);
        setTimeout(() => onClose(), 1500);
      } else if (activeTab === "url" && avatarUrl.trim()) {
        const res = await fetch(apiUrl("/api/users/avatar"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatarUrl: avatarUrl.trim() }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to save URL");
        }

        const data = await res.json();
        onAvatarChange(data.avatarUrl);
        setSuccess(true);
        setTimeout(() => onClose(), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save avatar");
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-lg rounded-xl border border-bot-border bg-bot-surface shadow-glass"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-bot-border/60">
          <h2 className="text-subtitle font-bold text-bot-text">Change Avatar</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab("upload")}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-body font-medium transition-all",
                activeTab === "upload"
                  ? "bg-bot-accent text-white"
                  : "bg-bot-elevated text-bot-muted hover:text-bot-text"
              )}
            >
              <Upload className="inline h-4 w-4 mr-2" />
              Upload Image
            </button>
            <button
              onClick={() => setActiveTab("url")}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-body font-medium transition-all",
                activeTab === "url"
                  ? "bg-bot-accent text-white"
                  : "bg-bot-elevated text-bot-muted hover:text-bot-text"
              )}
            >
              <LinkIcon className="inline h-4 w-4 mr-2" />
              Use URL
            </button>
          </div>

          {activeTab === "upload" && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-lg border-2 border-dashed border-bot-border/60 bg-bot-elevated/30 px-6 py-8 text-center hover:border-bot-accent hover:bg-bot-elevated/50 transition-all"
              >
                <Upload className="mx-auto h-8 w-8 text-bot-muted mb-2" />
                <p className="text-body text-bot-text mb-1">
                  Click to upload or drag and drop
                </p>
                <p className="text-caption text-bot-muted">
                  PNG, JPG, GIF up to 2MB
                </p>
              </button>
            </div>
          )}

          {activeTab === "url" && (
            <div className="space-y-4">
              <div>
                <label className="block text-caption font-medium text-bot-muted mb-2">
                  Image URL
                </label>
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://example.com/avatar.png"
                  className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent"
                />
              </div>
            </div>
          )}

          {previewUrl && (
            <div className="mt-4">
              <p className="text-caption font-medium text-bot-muted mb-2">Preview</p>
              <div className="flex justify-center">
                <div className="relative h-32 w-32 rounded-full border-2 border-bot-border bg-bot-surface overflow-hidden">
                  <img
                    src={previewUrl}
                    alt="Avatar preview"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-bot-red/40 bg-bot-red/10 px-3 py-2">
              <AlertCircle className="h-4 w-4 text-bot-red shrink-0 mt-0.5" />
              <p className="text-caption text-bot-red">{error}</p>
            </div>
          )}

          {success && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-bot-green/40 bg-bot-green/10 px-3 py-2">
              <Check className="h-4 w-4 text-bot-green shrink-0 mt-0.5" />
              <p className="text-caption text-bot-green">Avatar updated successfully!</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-bot-border/60">
          <button
            onClick={onClose}
            disabled={uploading}
            className="rounded-lg border border-bot-border px-4 py-2 text-body font-medium text-bot-muted hover:text-bot-text transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={uploading || !previewUrl || success}
            className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
          >
            {uploading ? "Saving..." : success ? "Saved!" : "Save Avatar"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
