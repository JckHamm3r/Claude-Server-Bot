"use client";

import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Palette,
  MessageSquare,
  Code,
  Zap,
  Globe,
  Layout,
  AlertCircle,
  GitCommit,
  RotateCcw,
  Pencil,
  Trash2,
  Save,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import type { TransformerRecord, TransformerType } from "@/lib/transformer-types";
import { TransformerConfigEditor } from "./transformer-config-editor";

interface TransformerCardProps {
  transformer: TransformerRecord;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (transformer: TransformerRecord) => void;
  onRefresh: () => void;
}

const TYPE_ICONS: Record<TransformerType, React.ElementType> = {
  theme: Palette,
  prompt: MessageSquare,
  api: Code,
  hook: Zap,
  static: Globe,
  widget: Layout,
};

const TYPE_COLORS: Record<TransformerType, string> = {
  theme: "bg-bot-blue/15 text-bot-blue border-bot-blue/25",
  prompt: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  api: "bg-bot-green/15 text-bot-green border-bot-green/25",
  hook: "bg-bot-amber/15 text-bot-amber border-bot-amber/25",
  static: "bg-teal-500/15 text-teal-400 border-teal-500/25",
  widget: "bg-pink-500/15 text-pink-400 border-pink-500/25",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-bot-green",
  disabled: "bg-bot-muted/40",
  error: "bg-bot-red",
  loading: "bg-bot-amber animate-pulse",
};

function resolveIcon(iconName: string | undefined, type: TransformerType): React.ElementType {
  if (!iconName) return TYPE_ICONS[type];
  const map: Record<string, React.ElementType> = {
    Palette, MessageSquare, Code, Zap, Globe, Layout,
  };
  return map[iconName] ?? TYPE_ICONS[type];
}

export function TransformerCard({
  transformer,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onDelete,
  onEdit,
  onRefresh,
}: TransformerCardProps) {
  const [toggling, setToggling] = useState(false);
  const [configValues, setConfigValues] = useState<Record<string, string | number | boolean | string[]>>(
    transformer.configValues ?? {}
  );
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const Icon = resolveIcon(transformer.icon, transformer.type);

  const handleToggle = useCallback(async () => {
    if (toggling) return;
    setToggling(true);
    try {
      await fetch(apiUrl(`/api/transformers/${transformer.id}/toggle`), {
        method: "POST",
      });
      onToggleEnabled(transformer.id);
    } finally {
      setToggling(false);
    }
  }, [toggling, transformer.id, onToggleEnabled]);

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      await fetch(apiUrl(`/api/transformers/${transformer.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configValues }),
      });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
      onRefresh();
    } finally {
      setSavingConfig(false);
    }
  }, [transformer.id, configValues, onRefresh]);

  const handleRollback = useCallback(async (hash: string) => {
    setRollingBack(hash);
    try {
      await fetch(apiUrl(`/api/transformers/${transformer.id}/rollback`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash }),
      });
      onRefresh();
    } finally {
      setRollingBack(null);
    }
  }, [transformer.id, onRefresh]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setDeleting(true);
    try {
      await fetch(apiUrl(`/api/transformers/${transformer.id}`), {
        method: "DELETE",
      });
      onDelete(transformer.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [confirmDelete, transformer.id, onDelete]);

  const hasConfig = transformer.config && Object.keys(transformer.config).length > 0;
  const hasGitLog = transformer.gitLog && transformer.gitLog.length > 0;

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-200",
        expanded
          ? "border-bot-accent/30 bg-bot-elevated shadow-lg shadow-black/20"
          : "border-bot-border bg-bot-surface hover:border-bot-border/80 hover:bg-bot-elevated/50"
      )}
    >
      {/* Card header */}
      <div className="flex items-center gap-3 p-4">
        {/* Icon */}
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            TYPE_COLORS[transformer.type]
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-bot-text leading-tight">
              {transformer.name}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                TYPE_COLORS[transformer.type]
              )}
            >
              {transformer.type}
            </span>
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                STATUS_COLORS[transformer.status] ?? "bg-bot-muted/40"
              )}
              title={transformer.status}
            />
          </div>
          <p className="mt-0.5 text-xs text-bot-muted line-clamp-1">
            {transformer.description}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={transformer.enabled}
            onClick={handleToggle}
            disabled={toggling}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-bot-accent/50 focus:ring-offset-2 focus:ring-offset-bot-bg disabled:opacity-50",
              transformer.enabled ? "bg-bot-accent" : "bg-bot-border"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
                transformer.enabled ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>

          {/* Expand toggle */}
          <button
            onClick={onToggleExpand}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-bot-border/40 px-4 pb-4 pt-4 space-y-5">
          {/* Error message */}
          {transformer.status === "error" && transformer.errorMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-bot-red/20 bg-bot-red/5 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-bot-red shrink-0 mt-0.5" />
              <p className="text-xs text-bot-red/90">{transformer.errorMessage}</p>
            </div>
          )}

          {/* Meta */}
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-bot-muted">
            <span>
              <span className="text-bot-text/50">Version</span>{" "}
              <span className="font-mono text-bot-text">{transformer.version}</span>
            </span>
            {transformer.author && (
              <span>
                <span className="text-bot-text/50">Author</span>{" "}
                <span className="text-bot-text">{transformer.author}</span>
              </span>
            )}
            <span>
              <span className="text-bot-text/50">Created</span>{" "}
              <span className="text-bot-text">
                {new Date(transformer.created).toLocaleDateString()}
              </span>
            </span>
            {transformer.updated && (
              <span>
                <span className="text-bot-text/50">Updated</span>{" "}
                <span className="text-bot-text">
                  {new Date(transformer.updated).toLocaleDateString()}
                </span>
              </span>
            )}
          </div>

          {/* Config editor */}
          {hasConfig && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-bot-text uppercase tracking-wide">
                Configuration
              </h4>
              <TransformerConfigEditor
                configSchema={transformer.config!}
                values={configValues}
                onChange={(key, value) =>
                  setConfigValues((prev) => ({ ...prev, [key]: value }))
                }
              />
              <button
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  configSaved
                    ? "bg-bot-green/20 text-bot-green border border-bot-green/30"
                    : "bg-bot-accent/10 text-bot-accent border border-bot-accent/20 hover:bg-bot-accent/20 disabled:opacity-50"
                )}
              >
                <Save className="h-3.5 w-3.5" />
                {savingConfig ? "Saving…" : configSaved ? "Saved!" : "Save Config"}
              </button>
            </div>
          )}

          {/* Git log */}
          {hasGitLog && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-bot-text uppercase tracking-wide">
                Version History
              </h4>
              <div className="rounded-lg border border-bot-border/50 divide-y divide-bot-border/30 overflow-hidden">
                {transformer.gitLog!.map((entry) => (
                  <div
                    key={entry.hash}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-bot-elevated/50 transition-colors group"
                  >
                    <GitCommit className="h-3.5 w-3.5 text-bot-muted shrink-0" />
                    <code className="text-[11px] font-mono text-bot-accent shrink-0">
                      {entry.shortHash}
                    </code>
                    <span className="flex-1 min-w-0 text-xs text-bot-text truncate">
                      {entry.message}
                    </span>
                    <span className="text-[11px] text-bot-muted shrink-0">
                      {new Date(entry.date).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => handleRollback(entry.hash)}
                      disabled={rollingBack === entry.hash}
                      className="flex items-center gap-1 text-[11px] text-bot-muted hover:text-bot-amber opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50 shrink-0"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {rollingBack === entry.hash ? "…" : "Rollback"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => onEdit(transformer)}
              className="flex items-center gap-1.5 rounded-lg border border-bot-border px-3 py-1.5 text-xs text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit in AI Chat
            </button>

            <button
              onClick={handleDelete}
              disabled={deleting}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all disabled:opacity-50",
                confirmDelete
                  ? "border-bot-red/40 bg-bot-red/10 text-bot-red hover:bg-bot-red/20"
                  : "border-bot-border text-bot-muted hover:text-bot-red hover:border-bot-red/30 hover:bg-bot-red/5"
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? "Deleting…" : confirmDelete ? "Confirm Delete" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
