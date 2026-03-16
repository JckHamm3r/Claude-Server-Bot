"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { ModelSelector } from "../model-selector";
import { DEFAULT_MODEL } from "@/lib/models";

interface SessionTemplate {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  model: string;
  skip_permissions: boolean;
  provider_type: string;
  icon: string | null;
  is_default: boolean;
  created_by: string;
  created_at: string;
}

export function TemplatesSection() {
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSystemPrompt, setFormSystemPrompt] = useState("");
  const [formModel, setFormModel] = useState(DEFAULT_MODEL);
  const [formSkipPermissions, setFormSkipPermissions] = useState(false);
  const [formIcon, setFormIcon] = useState("");

  useEffect(() => {
    const socket = getSocket();
    const handleTemplates = ({ templates: t }: { templates: SessionTemplate[] }) => {
      setTemplates(t);
      setSaving(false);
    };
    const handleError = ({ message }: { message: string }) => {
      setSaving(false);
      setMsg({ ok: false, text: message ?? "Operation failed" });
      setTimeout(() => setMsg(null), 4000);
    };
    socket.on("claude:templates", handleTemplates);
    socket.on("claude:error", handleError);
    socket.emit("claude:list_templates");
    return () => {
      socket.off("claude:templates", handleTemplates);
      socket.off("claude:error", handleError);
    };
  }, []);

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormSystemPrompt("");
    setFormModel(DEFAULT_MODEL);
    setFormSkipPermissions(false);
    setFormIcon("");
  };

  const startCreate = () => {
    resetForm();
    setEditing(null);
    setCreating(true);
  };

  const startEdit = (t: SessionTemplate) => {
    setFormName(t.name);
    setFormDescription(t.description ?? "");
    setFormSystemPrompt(t.system_prompt ?? "");
    setFormModel(t.model);
    setFormSkipPermissions(t.skip_permissions);
    setFormIcon(t.icon ?? "");
    setCreating(false);
    setEditing(t.id);
  };

  const handleSave = () => {
    if (!formName.trim() || saving) return;
    const socket = getSocket();
    setSaving(true);
    const data = {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      system_prompt: formSystemPrompt.trim() || undefined,
      model: formModel,
      skip_permissions: formSkipPermissions,
      icon: formIcon.trim() || undefined,
    };

    if (creating) {
      socket.emit("claude:create_template", data);
    } else if (editing) {
      socket.emit("claude:update_template", { templateId: editing, data });
    }
    setCreating(false);
    setEditing(null);
    resetForm();
    setMsg({ ok: true, text: creating ? "Template created" : "Template saved" });
    setTimeout(() => setMsg(null), 3000);
  };

  const handleDelete = (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    const socket = getSocket();
    socket.emit("claude:delete_template", { templateId: id });
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setMsg({ ok: true, text: "Template deleted" });
    setTimeout(() => setMsg(null), 3000);
  };

  const isFormOpen = creating || editing !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-subtitle font-semibold text-bot-text">Session Templates</h2>
        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 rounded-md bg-bot-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-bot-accent/80 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Template
        </button>
      </div>

      <p className="text-caption text-bot-muted">
        Templates pre-configure new sessions with a model, system prompt, and other settings.
      </p>
      {msg && (
        <p className={`text-caption ${msg.ok ? "text-bot-green" : "text-bot-red"}`}>{msg.text}</p>
      )}

      {isFormOpen && (
        <div className="rounded-lg border border-bot-border bg-bot-elevated p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-body font-medium text-bot-text">
              {creating ? "New Template" : "Edit Template"}
            </span>
            <button onClick={() => { setCreating(false); setEditing(null); }}
              className="rounded p-1 text-bot-muted hover:bg-bot-surface transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-caption font-medium text-bot-muted">Name</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Code Review"
                className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent" />
            </div>
            <div>
              <label className="mb-1 block text-caption font-medium text-bot-muted">Icon (emoji)</label>
              <input type="text" value={formIcon} onChange={(e) => setFormIcon(e.target.value)}
                placeholder="e.g. 🔍"
                className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-caption font-medium text-bot-muted">Description</label>
            <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Brief description"
              className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent" />
          </div>

          <div>
            <label className="mb-1 block text-caption font-medium text-bot-muted">System Prompt</label>
            <textarea value={formSystemPrompt} onChange={(e) => setFormSystemPrompt(e.target.value)}
              placeholder="Instructions for Claude when using this template..."
              rows={4}
              className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent resize-none" />
          </div>

          <div>
            <label className="mb-1 block text-caption font-medium text-bot-muted">Model</label>
            <ModelSelector value={formModel} onChange={setFormModel} />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={formSkipPermissions} onChange={(e) => setFormSkipPermissions(e.target.checked)}
              className="h-4 w-4 rounded border-bot-border accent-bot-accent" />
            <span className="text-body text-bot-text">Skip permissions</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setCreating(false); setEditing(null); }}
              className="rounded-md border border-bot-border px-4 py-2 text-body text-bot-muted hover:bg-bot-surface transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={!formName.trim() || saving}
              className="rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors">
              {saving ? "Saving…" : creating ? "Create" : "Save"}
            </button>
          </div>
        </div>
      )}

      {templates.length === 0 && !isFormOpen && (
        <p className="text-body text-bot-muted py-4">No templates yet. Create one to get started.</p>
      )}

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-bot-border bg-bot-elevated px-4 py-3 group">
            <span className="text-lg">{t.icon ?? "📋"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-bot-text">{t.name}</p>
              {t.description && <p className="text-caption text-bot-muted truncate">{t.description}</p>}
              <p className="text-[10px] font-mono text-bot-muted mt-0.5">
                {t.model} {t.skip_permissions ? "· skip-perms" : ""}
              </p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(t)}
                className="rounded p-1 text-bot-muted hover:text-bot-accent hover:bg-bot-surface transition-colors"
                title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {confirmDelete === t.id ? (
                <button onClick={() => handleDelete(t.id)}
                  className="rounded px-2 py-1 text-caption text-bot-red bg-bot-red/10 hover:bg-bot-red/20 transition-colors"
                  title="Click again to confirm delete">
                  Confirm
                </button>
              ) : (
                <button onClick={() => handleDelete(t.id)}
                  className="rounded p-1 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-colors"
                  title="Delete (click to confirm)">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
