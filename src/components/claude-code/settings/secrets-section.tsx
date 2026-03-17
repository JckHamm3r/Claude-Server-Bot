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
} from "lucide-react";
import { apiUrl } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface SecretVar {
  key: string;
  isSet: boolean;
}

const KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

export function SecretsSection() {
  const [vars, setVars] = useState<SecretVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Restart banner
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);

  // Add new var form
  const [showAdd, setShowAdd] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  // Edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirmation
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);

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
        body: JSON.stringify({ key: addKey.trim().toUpperCase(), value: addValue }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setAddKey("");
        setAddValue("");
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

  function startEdit(key: string) {
    setEditingKey(key);
    setEditValue("");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditValue("");
    setEditError(null);
  }

  async function handleEditSave(key: string) {
    if (!editValue.trim() && editValue === "") {
      setEditError("Enter a new value (leave blank only if intentionally clearing)");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(apiUrl("/api/settings/secrets"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: editValue }),
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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-subtitle font-bold text-bot-text flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-bot-accent" />
          Secrets
        </h3>
        <p className="text-caption text-bot-muted mt-1">
          Manage environment variables stored in <code className="font-mono bg-bot-elevated/60 px-1 rounded">.env</code>.
          Values are write-only and are never displayed. Changes take effect after a server restart.
        </p>
      </div>

      {/* Expert-admin notice */}
      <div className="flex items-start gap-2 rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2.5 text-caption text-bot-muted">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-bot-accent" />
        <span>
          This section is restricted to Expert Admins. Variables listed here are user-managed; system
          variables (routing slugs, auth secrets, etc.) are managed by the install script and are not
          accessible here.
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

      {/* Variable list */}
      <div className="space-y-1.5">
        {vars.length === 0 && (
          <p className="text-caption text-bot-muted/60 py-2">
            No user-managed secrets defined yet.
          </p>
        )}

        {vars.map((v) => (
          <div key={v.key} className="rounded-lg border border-bot-border/30 bg-bot-surface/60 overflow-hidden">
            {/* Row */}
            <div className="flex items-center gap-3 px-3 py-2.5">
              <code className="flex-1 text-body font-mono text-bot-text min-w-0 truncate">
                {v.key}
              </code>
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
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => editingKey === v.key ? cancelEdit() : startEdit(v.key)}
                  title="Edit value"
                  className="p-1.5 rounded-md text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => deletingKey === v.key ? cancelDelete() : startDelete(v.key)}
                  title="Delete variable"
                  className="p-1.5 rounded-md text-bot-muted hover:text-bot-error hover:bg-bot-error/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Inline edit */}
            {editingKey === v.key && (
              <div className="border-t border-bot-border/30 px-3 py-2.5 space-y-2">
                <label className="text-caption text-bot-muted">New value for {v.key}</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="Enter new value…"
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
                    {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="shrink-0 p-1.5 rounded-md text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {editError && <p className="text-caption text-bot-error">{editError}</p>}
              </div>
            )}

            {/* Inline delete confirmation */}
            {deletingKey === v.key && (
              <div className="border-t border-bot-border/30 bg-bot-error/5 px-3 py-2.5 space-y-2">
                <p className="text-caption text-bot-error">
                  This will permanently remove <code className="font-mono">{v.key}</code> from <code className="font-mono">.env</code>.
                  Type the variable name to confirm.
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
                    {deleteSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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
                  if (e.key === "Escape") { setShowAdd(false); setAddKey(""); setAddValue(""); setAddError(null); }
                }}
                className="w-full rounded-md border border-bot-border/50 bg-bot-elevated/50 px-3 py-1.5 text-body font-mono text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50"
                autoFocus
              />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <label className="text-[11px] text-bot-muted uppercase tracking-wide">Value</label>
              <input
                type="password"
                placeholder="Value (write-only)"
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") { setShowAdd(false); setAddKey(""); setAddValue(""); setAddError(null); }
                }}
                className="w-full rounded-md border border-bot-border/50 bg-bot-elevated/50 px-3 py-1.5 text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50"
              />
            </div>
          </div>
          {addError && <p className="text-caption text-bot-error">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={addSaving}
              className="flex items-center gap-1.5 rounded-md bg-bot-accent/10 border border-bot-accent/30 px-3 py-1.5 text-caption font-medium text-bot-accent hover:bg-bot-accent/20 transition-colors disabled:opacity-50"
            >
              {addSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Save Variable
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddKey(""); setAddValue(""); setAddError(null); }}
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
