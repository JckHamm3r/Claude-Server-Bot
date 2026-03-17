"use client";

import { useEffect, useState } from "react";
import {
  KeyRound,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Lock,
  Braces,
  Copy,
  CheckCheck,
} from "lucide-react";
import { apiUrl } from "@/lib/utils";
import { cn } from "@/lib/utils";

type SecretType = "secret" | "api_key" | "variable";

interface SecretVar {
  key: string;
  isSet: boolean;
  type: SecretType;
  description: string;
  value?: string;       // only for type=variable
  maskedValue?: string; // only for type=api_key
}

const KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

const TYPE_OPTIONS: { id: SecretType; label: string; short: string }[] = [
  { id: "secret", label: "Secret", short: "Secret" },
  { id: "api_key", label: "API Key", short: "API Key" },
  { id: "variable", label: "Variable", short: "Variable" },
];

function TypeBadge({ type }: { type: SecretType }) {
  if (type === "secret") {
    return (
      <span className="inline-flex items-center gap-1 shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-bot-error/15 text-bot-error">
        <Lock className="w-2.5 h-2.5" />
        Secret
      </span>
    );
  }
  if (type === "api_key") {
    return (
      <span className="inline-flex items-center gap-1 shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-yellow-500/15 text-yellow-400">
        <KeyRound className="w-2.5 h-2.5" />
        API Key
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-bot-accent/15 text-bot-accent">
      <Braces className="w-2.5 h-2.5" />
      Variable
    </span>
  );
}

function TypeSelector({
  value,
  onChange,
}: {
  value: SecretType;
  onChange: (t: SecretType) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {TYPE_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors",
            value === opt.id
              ? opt.id === "secret"
                ? "border-bot-error/50 bg-bot-error/10 text-bot-error"
                : opt.id === "api_key"
                  ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-400"
                  : "border-bot-accent/50 bg-bot-accent/10 text-bot-accent"
              : "border-bot-border/40 bg-transparent text-bot-muted hover:text-bot-text hover:border-bot-border/70",
          )}
        >
          {opt.short}
        </button>
      ))}
    </div>
  );
}

export function SecretsSection() {
  const [vars, setVars] = useState<SecretVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter tab
  const [filterTab, setFilterTab] = useState<"all" | SecretType>("all");

  // Restart banner
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);

  // Add new var form
  const [showAdd, setShowAdd] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addType, setAddType] = useState<SecretType>("secret");
  const [addDescription, setAddDescription] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  // Edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editType, setEditType] = useState<SecretType>("secret");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirmation
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);

  // Copy feedback (key -> "copied" timeout handle)
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Flash messages
  const [flashMsg, setFlashMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    fetch(apiUrl("/api/settings/secrets"))
      .then((r) => r.json())
      .then((d: { vars?: SecretVar[]; error?: string }) => {
        if (d.error) {
          setLoadError(d.error);
        } else {
          setVars(d.vars ?? []);
        }
      })
      .catch(() => setLoadError("Failed to load secrets"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  function flash(ok: boolean, text: string) {
    setFlashMsg({ ok, text });
    setTimeout(() => setFlashMsg(null), 4000);
  }

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filteredVars = filterTab === "all" ? vars : vars.filter((v) => v.type === filterTab);

  const counts = {
    all: vars.length,
    secret: vars.filter((v) => v.type === "secret").length,
    api_key: vars.filter((v) => v.type === "api_key").length,
    variable: vars.filter((v) => v.type === "variable").length,
  };

  // ── Add ──────────────────────────────────────────────────────────────────

  function validateAddKey(): string | null {
    const k = addKey.trim().toUpperCase();
    if (!k) return "Key is required";
    if (!KEY_REGEX.test(k)) return "Key must only contain A-Z, 0-9, _ and start with a letter or _";
    if (vars.some((v) => v.key === k)) return `${k} already exists — use the edit button to update it`;
    return null;
  }

  async function handleAdd() {
    const err = validateAddKey();
    if (err) {
      setAddError(err);
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await fetch(apiUrl("/api/settings/secrets"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: addKey.trim().toUpperCase(),
          value: addValue,
          type: addType,
          description: addDescription,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setAddKey("");
        setAddValue("");
        setAddType("secret");
        setAddDescription("");
        setShowAdd(false);
        setNeedsRestart(true);
        flash(true, `${addKey.trim().toUpperCase()} saved`);
        load();
      } else {
        setAddError(data.error ?? "Failed to save");
      }
    } catch {
      setAddError("Network error");
    } finally {
      setAddSaving(false);
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────

  function startEdit(v: SecretVar) {
    setEditingKey(v.key);
    setEditValue(v.type === "variable" ? (v.value ?? "") : "");
    setEditType(v.type);
    setEditDescription(v.description);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditValue("");
    setEditError(null);
  }

  async function handleEditSave(key: string) {
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(apiUrl("/api/settings/secrets"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          value: editValue,
          type: editType,
          description: editDescription,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        cancelEdit();
        setNeedsRestart(true);
        flash(true, `${key} updated`);
        load();
      } else {
        setEditError(data.error ?? "Failed to save");
      }
    } catch {
      setEditError("Network error");
    } finally {
      setEditSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  function startDelete(key: string) {
    setDeletingKey(key);
    setDeleteConfirm("");
  }

  function cancelDelete() {
    setDeletingKey(null);
    setDeleteConfirm("");
  }

  async function handleDelete(key: string) {
    if (deleteConfirm !== key) return;
    setDeleteSaving(true);
    try {
      const res = await fetch(apiUrl("/api/settings/secrets"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        cancelDelete();
        setNeedsRestart(true);
        flash(true, `${key} deleted`);
        load();
      } else {
        flash(false, data.error ?? "Failed to delete");
        cancelDelete();
      }
    } catch {
      flash(false, "Network error");
      cancelDelete();
    } finally {
      setDeleteSaving(false);
    }
  }

  // ── Copy API key ──────────────────────────────────────────────────────────

  async function handleCopyApiKey(key: string) {
    try {
      const res = await fetch(apiUrl(`/api/settings/secrets?reveal=${encodeURIComponent(key)}`));
      const data = (await res.json()) as { key?: string; value?: string; error?: string };
      if (data.value !== undefined) {
        await navigator.clipboard.writeText(data.value);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
      } else {
        flash(false, data.error ?? "Failed to copy");
      }
    } catch {
      flash(false, "Failed to copy to clipboard");
    }
  }

  // ── Restart ───────────────────────────────────────────────────────────────

  async function handleRestart() {
    setRestarting(true);
    setRestartMsg(null);
    try {
      const res = await fetch(apiUrl("/api/system/service"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (data.ok) {
        setRestartMsg(data.message ?? "Server restart initiated. Reconnect in a few seconds.");
        setNeedsRestart(false);
      } else {
        setRestartMsg(data.message ?? "Restart failed or systemd is not available on this system.");
      }
    } catch {
      setRestartMsg("Network error — restart the server manually.");
    } finally {
      setRestarting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-bot-muted text-caption py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-bot-error text-caption py-4">
        <AlertTriangle className="w-4 h-4" />
        {loadError}
      </div>
    );
  }

  const FILTER_TABS: { id: "all" | SecretType; label: string }[] = [
    { id: "all", label: "All" },
    { id: "secret", label: "Secrets" },
    { id: "api_key", label: "API Keys" },
    { id: "variable", label: "Variables" },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-subtitle font-bold text-bot-text flex items-center gap-2 mb-6">
          <KeyRound className="w-4 h-4 text-bot-accent" />
          Secrets
        </h2>
        <p className="text-caption text-bot-muted mt-1">
          Manage environment variables stored in{" "}
          <code className="font-mono bg-bot-elevated/60 px-1 rounded">.env</code>.
          Changes take effect after a server restart.
        </p>
      </div>

      {/* Expert-admin notice */}
      <div className="flex items-start gap-2 rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2.5 text-caption text-bot-muted">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-bot-accent" />
        <span>
          This section is restricted to Expert Admins. System variables (routing slugs, auth
          secrets, etc.) are managed by the install script and are not accessible here.
        </span>
      </div>

      {/* Restart banner */}
      {needsRestart && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2.5">
          <div className="flex items-center gap-2 text-caption text-yellow-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Environment changes require a server restart to take full effect.
          </div>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="shrink-0 flex items-center gap-1.5 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-2.5 py-1 text-caption font-medium text-yellow-300 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
          >
            {restarting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Restart Server
          </button>
        </div>
      )}

      {/* Restart message (post-restart) */}
      {restartMsg && (
        <div className="rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2 text-caption text-bot-muted">
          {restartMsg}
        </div>
      )}

      {/* Flash message */}
      {flashMsg && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-caption",
            flashMsg.ok
              ? "border-bot-green/40 bg-bot-green/10 text-bot-green"
              : "border-bot-error/40 bg-bot-error/10 text-bot-error",
          )}
        >
          {flashMsg.text}
        </div>
      )}

      {/* Filter tabs */}
      {vars.length > 0 && (
        <div className="flex items-center gap-1 border-b border-bot-border/30 pb-0">
          {FILTER_TABS.map((tab) => {
            const count = counts[tab.id];
            return (
              <button
                key={tab.id}
                onClick={() => setFilterTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium border-b-2 -mb-px transition-colors",
                  filterTab === tab.id
                    ? "border-bot-accent text-bot-accent"
                    : "border-transparent text-bot-muted hover:text-bot-text",
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                      filterTab === tab.id
                        ? "bg-bot-accent/15 text-bot-accent"
                        : "bg-bot-border/30 text-bot-muted",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Variable list */}
      <div className="space-y-1.5">
        {filteredVars.length === 0 && (
          <p className="text-caption text-bot-muted/60 py-2">
            {vars.length === 0
              ? "No user-managed secrets defined yet."
              : `No ${filterTab === "api_key" ? "API keys" : filterTab + "s"} defined yet.`}
          </p>
        )}

        {filteredVars.map((v) => (
          <div
            key={v.key}
            className="rounded-lg border border-bot-border/30 bg-bot-surface/60 overflow-hidden"
          >
            {/* Row */}
            <div className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-body font-mono text-bot-text truncate">
                    {v.key}
                  </code>
                  <TypeBadge type={v.type} />
                  {v.type === "secret" && (
                    <span
                      className={cn(
                        "shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium",
                        v.isSet
                          ? "bg-bot-green/15 text-bot-green"
                          : "bg-bot-muted/10 text-bot-muted",
                      )}
                    >
                      {v.isSet ? "Set" : "Not set"}
                    </span>
                  )}
                </div>
                {v.description && (
                  <p className="text-[11px] text-bot-muted/70 mt-0.5 truncate">{v.description}</p>
                )}
                {/* API key masked value */}
                {v.type === "api_key" && v.maskedValue && (
                  <code className="text-[11px] font-mono text-bot-muted/60 mt-0.5 block">
                    {v.maskedValue}
                  </code>
                )}
                {/* Variable value display */}
                {v.type === "variable" && editingKey !== v.key && (
                  <code className="text-[11px] font-mono text-bot-muted/60 mt-0.5 block truncate">
                    {v.value ?? ""}
                  </code>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Copy button for API keys */}
                {v.type === "api_key" && v.isSet && (
                  <button
                    onClick={() => handleCopyApiKey(v.key)}
                    title="Copy API key"
                    className="p-1.5 rounded-md text-bot-muted hover:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                  >
                    {copiedKey === v.key ? (
                      <CheckCheck className="w-3.5 h-3.5 text-bot-green" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => (editingKey === v.key ? cancelEdit() : startEdit(v))}
                  title="Edit"
                  className="p-1.5 rounded-md text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => (deletingKey === v.key ? cancelDelete() : startDelete(v.key))}
                  title="Delete variable"
                  className="p-1.5 rounded-md text-bot-muted hover:text-bot-error hover:bg-bot-error/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Inline edit */}
            {editingKey === v.key && (
              <div className="border-t border-bot-border/30 px-3 py-3 space-y-3">
                {/* Type selector */}
                <div className="space-y-1">
                  <label className="text-[11px] text-bot-muted uppercase tracking-wide">Type</label>
                  <TypeSelector value={editType} onChange={setEditType} />
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <label className="text-[11px] text-bot-muted uppercase tracking-wide">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="What this variable is used for…"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full rounded-md border border-bot-border/50 bg-bot-elevated/50 px-3 py-1.5 text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50"
                  />
                </div>

                {/* Value */}
                <div className="space-y-1">
                  <label className="text-[11px] text-bot-muted uppercase tracking-wide">
                    New value for {v.key}
                    {editType === "secret" || editType === "api_key" ? " (write-only)" : ""}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={editType === "variable" ? "text" : "password"}
                      placeholder={
                        editType === "variable"
                          ? "Enter value…"
                          : "Enter new value (leave blank to keep current)…"
                      }
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEditSave(v.key);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="flex-1 min-w-0 rounded-md border border-bot-border/50 bg-bot-elevated/50 px-3 py-1.5 text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50"
                      autoFocus
                    />
                    <button
                      onClick={() => handleEditSave(v.key)}
                      disabled={editSaving}
                      className="shrink-0 flex items-center gap-1.5 rounded-md bg-bot-accent/10 border border-bot-accent/30 px-3 py-1.5 text-caption font-medium text-bot-accent hover:bg-bot-accent/20 transition-colors disabled:opacity-50"
                    >
                      {editSaving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="shrink-0 p-1.5 rounded-md text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {editError && <p className="text-caption text-bot-error">{editError}</p>}
              </div>
            )}

            {/* Inline delete confirmation */}
            {deletingKey === v.key && (
              <div className="border-t border-bot-border/30 bg-bot-error/5 px-3 py-2.5 space-y-2">
                <p className="text-caption text-bot-error">
                  This will permanently remove{" "}
                  <code className="font-mono">{v.key}</code> from{" "}
                  <code className="font-mono">.env</code>. Type the variable name to confirm.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={v.key}
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && deleteConfirm === v.key) handleDelete(v.key);
                      if (e.key === "Escape") cancelDelete();
                    }}
                    className="flex-1 min-w-0 rounded-md border border-bot-error/30 bg-bot-elevated/50 px-3 py-1.5 text-body font-mono text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-error/60"
                    autoFocus
                  />
                  <button
                    onClick={() => handleDelete(v.key)}
                    disabled={deleteConfirm !== v.key || deleteSaving}
                    className="shrink-0 flex items-center gap-1.5 rounded-md bg-bot-error/10 border border-bot-error/30 px-3 py-1.5 text-caption font-medium text-bot-error hover:bg-bot-error/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deleteSaving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    Delete
                  </button>
                  <button
                    onClick={cancelDelete}
                    className="shrink-0 p-1.5 rounded-md text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add variable */}
      {showAdd ? (
        <div className="rounded-lg border border-bot-accent/30 bg-bot-elevated/30 px-3 py-3 space-y-3">
          <p className="text-caption font-medium text-bot-text">Add Environment Variable</p>

          {/* Type selector */}
          <div className="space-y-1">
            <label className="text-[11px] text-bot-muted uppercase tracking-wide">Type</label>
            <TypeSelector value={addType} onChange={setAddType} />
          </div>

          {/* Key + Value row */}
          <div className="flex gap-2">
            <div className="flex-1 min-w-0 space-y-1">
              <label className="text-[11px] text-bot-muted uppercase tracking-wide">Key</label>
              <input
                type="text"
                placeholder="MY_SECRET_KEY"
                value={addKey}
                onChange={(e) => {
                  setAddKey(e.target.value.toUpperCase());
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowAdd(false);
                    setAddKey("");
                    setAddValue("");
                    setAddDescription("");
                    setAddError(null);
                  }
                }}
                className="w-full rounded-md border border-bot-border/50 bg-bot-elevated/50 px-3 py-1.5 text-body font-mono text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50"
                autoFocus
              />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <label className="text-[11px] text-bot-muted uppercase tracking-wide">
                Value
                {addType !== "variable" && (
                  <span className="ml-1 normal-case">(write-only)</span>
                )}
              </label>
              <input
                type={addType === "variable" ? "text" : "password"}
                placeholder={addType === "variable" ? "Value" : "Value (write-only)"}
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") {
                    setShowAdd(false);
                    setAddKey("");
                    setAddValue("");
                    setAddDescription("");
                    setAddError(null);
                  }
                }}
                className="w-full rounded-md border border-bot-border/50 bg-bot-elevated/50 px-3 py-1.5 text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-[11px] text-bot-muted uppercase tracking-wide">
              Description (optional)
            </label>
            <input
              type="text"
              placeholder="What this variable is used for…"
              value={addDescription}
              onChange={(e) => setAddDescription(e.target.value)}
              className="w-full rounded-md border border-bot-border/50 bg-bot-elevated/50 px-3 py-1.5 text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50"
            />
          </div>

          {addError && <p className="text-caption text-bot-error">{addError}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={addSaving}
              className="flex items-center gap-1.5 rounded-md bg-bot-accent/10 border border-bot-accent/30 px-3 py-1.5 text-caption font-medium text-bot-accent hover:bg-bot-accent/20 transition-colors disabled:opacity-50"
            >
              {addSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Save Variable
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setAddKey("");
                setAddValue("");
                setAddDescription("");
                setAddError(null);
              }}
              className="flex items-center gap-1.5 rounded-md border border-bot-border/40 px-3 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-bot-border/50 px-3 py-2.5 text-caption text-bot-muted hover:text-bot-text hover:border-bot-accent/40 hover:bg-bot-elevated/30 transition-all w-full"
        >
          <Plus className="w-4 h-4" />
          Add Variable
        </button>
      )}
    </div>
  );
}
