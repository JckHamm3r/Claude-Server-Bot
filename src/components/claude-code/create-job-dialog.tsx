"use client";

import { useState, useEffect } from "react";
import { X, Clock, FileCode, FolderOpen, Settings2, Bell, ChevronDown } from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import type { Job } from "@/lib/claude-db";

interface CreateJobDialogProps {
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  initialData?: Job;
  isEditing?: boolean;
}

interface JobTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  schedule: string;
  schedule_display: string;
  script_hint: string;
}

const SCHEDULE_PRESETS = [
  { label: "Every 5 minutes", value: "*-*-* *:0/5:00", display: "Every 5 minutes" },
  { label: "Every 15 minutes", value: "*-*-* *:0/15:00", display: "Every 15 minutes" },
  { label: "Every hour", value: "*-*-* *:00:00", display: "Every hour" },
  { label: "Every 6 hours", value: "*-*-* 0/6:00:00", display: "Every 6 hours" },
  { label: "Daily at midnight", value: "*-*-* 00:00:00", display: "Daily at midnight" },
  { label: "Daily at 2:00 AM", value: "*-*-* 02:00:00", display: "Daily at 2:00 AM" },
  { label: "Daily at 9:00 AM", value: "*-*-* 09:00:00", display: "Daily at 9:00 AM" },
  { label: "Weekly (Monday 9 AM)", value: "Mon *-*-* 09:00:00", display: "Every Monday at 9:00 AM" },
  { label: "Monthly (1st at midnight)", value: "*-*-01 00:00:00", display: "Monthly on the 1st" },
];

export function CreateJobDialog({ onClose, onSave, initialData, isEditing }: CreateJobDialogProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [scriptPath, setScriptPath] = useState(initialData?.script_path ?? "");
  const [schedule, setSchedule] = useState(initialData?.schedule ?? "*-*-* 02:00:00");
  const [scheduleDisplay, setScheduleDisplay] = useState(initialData?.schedule_display ?? "Daily at 2:00 AM");
  const [scheduleMode, setScheduleMode] = useState<"preset" | "custom">("preset");
  const [workingDirectory, setWorkingDirectory] = useState(initialData?.working_directory ?? "");
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string }[]>(() => {
    const env = initialData?.environment ?? {};
    const entries = Object.entries(env);
    return entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : [];
  });
  const [timeoutSeconds, setTimeoutSeconds] = useState(initialData?.timeout_seconds ?? 0);
  const [maxRetries, setMaxRetries] = useState(initialData?.max_retries ?? 0);
  const [autoDisableAfter, setAutoDisableAfter] = useState(initialData?.auto_disable_after ?? 0);
  const [notifyOnFailure, setNotifyOnFailure] = useState(initialData?.notify_on_failure ?? true);
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(initialData?.notify_on_success ?? false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(!isEditing);

  useEffect(() => {
    if (!isEditing) {
      fetch(apiUrl("/api/jobs/templates"))
        .then((r) => r.json())
        .then((d: { templates: JobTemplate[] }) => setTemplates(d.templates ?? []))
        .catch(() => {});
    }
  }, [isEditing]);

  useEffect(() => {
    if (initialData?.schedule) {
      const isPreset = SCHEDULE_PRESETS.some((p) => p.value === initialData.schedule);
      setScheduleMode(isPreset ? "preset" : "custom");
    }
  }, [initialData]);

  const applyTemplate = (tpl: JobTemplate) => {
    setName(tpl.name);
    setDescription(tpl.description);
    setSchedule(tpl.schedule);
    setScheduleDisplay(tpl.schedule_display);
    setShowTemplates(false);
  };

  const handlePresetChange = (value: string) => {
    setSchedule(value);
    const preset = SCHEDULE_PRESETS.find((p) => p.value === value);
    setScheduleDisplay(preset?.display ?? value);
  };

  const handleSave = () => {
    const environment: Record<string, string> = {};
    for (const pair of envPairs) {
      if (pair.key.trim()) environment[pair.key.trim()] = pair.value;
    }

    onSave({
      name: name.trim(),
      description: description.trim(),
      script_path: scriptPath.trim(),
      schedule,
      schedule_display: scheduleDisplay,
      working_directory: workingDirectory.trim(),
      environment,
      timeout_seconds: timeoutSeconds,
      max_retries: maxRetries,
      auto_disable_after: autoDisableAfter,
      notify_on_failure: notifyOnFailure,
      notify_on_success: notifyOnSuccess,
    });
  };

  const isValid = name.trim() && scriptPath.trim() && schedule.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-bot-border/30 bg-bot-bg shadow-2xl animate-fadeUp">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-bot-border/30 bg-bot-bg/95 backdrop-blur-md px-6 py-4">
          <h2 className="text-subtitle font-bold text-bot-text">
            {isEditing ? "Edit Job" : "Create New Job"}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated/60 hover:text-bot-text transition-all">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Templates */}
          {!isEditing && showTemplates && templates.length > 0 && (
            <div>
              <p className="text-caption font-semibold text-bot-text mb-3">Start from a template</p>
              <div className="grid grid-cols-2 gap-2">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    className="flex items-start gap-3 rounded-xl border border-bot-border/30 bg-bot-surface/60 p-3 text-left hover:border-bot-accent/30 hover:bg-bot-surface transition-all"
                  >
                    <span className="text-xl">{tpl.icon}</span>
                    <div className="min-w-0">
                      <p className="text-caption font-semibold text-bot-text truncate">{tpl.name}</p>
                      <p className="text-[10px] text-bot-muted line-clamp-1">{tpl.description}</p>
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowTemplates(false)}
                className="mt-2 text-caption text-bot-muted hover:text-bot-text transition-colors"
              >
                Skip — configure from scratch
              </button>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-caption font-semibold text-bot-text block mb-1.5">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nightly Database Backup"
              className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2 text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-caption font-semibold text-bot-text block mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this job do?"
              rows={2}
              className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2 text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all resize-none"
            />
          </div>

          {/* Script Path */}
          <div>
            <label className="text-caption font-semibold text-bot-text block mb-1.5">
              <FileCode className="h-3.5 w-3.5 inline mr-1.5" />
              Script Path *
            </label>
            <input
              value={scriptPath}
              onChange={(e) => setScriptPath(e.target.value)}
              placeholder="/path/to/your/script.sh"
              className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2 text-body text-bot-text font-mono placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all"
            />
            <p className="text-[10px] text-bot-muted mt-1">Absolute path to an executable script on this server</p>
          </div>

          {/* Schedule */}
          <div>
            <label className="text-caption font-semibold text-bot-text block mb-1.5">
              <Clock className="h-3.5 w-3.5 inline mr-1.5" />
              Schedule *
            </label>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setScheduleMode("preset")}
                className={cn(
                  "rounded-lg px-3 py-1 text-caption font-medium transition-all",
                  scheduleMode === "preset" ? "bg-bot-accent/10 text-bot-accent" : "text-bot-muted hover:text-bot-text",
                )}
              >
                Presets
              </button>
              <button
                onClick={() => setScheduleMode("custom")}
                className={cn(
                  "rounded-lg px-3 py-1 text-caption font-medium transition-all",
                  scheduleMode === "custom" ? "bg-bot-accent/10 text-bot-accent" : "text-bot-muted hover:text-bot-text",
                )}
              >
                Custom
              </button>
            </div>
            {scheduleMode === "preset" ? (
              <select
                value={schedule}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2 text-body text-bot-text focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all"
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                <input
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="*-*-* 02:00:00"
                  className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2 text-body text-bot-text font-mono placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all"
                />
                <input
                  value={scheduleDisplay}
                  onChange={(e) => setScheduleDisplay(e.target.value)}
                  placeholder="Human-readable description (e.g. Every day at 2am)"
                  className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2 text-caption text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all"
                />
                <p className="text-[10px] text-bot-muted">
                  Uses systemd OnCalendar format. Examples: <code className="font-mono">*-*-* *:00:00</code> (hourly), <code className="font-mono">Mon *-*-* 09:00:00</code> (weekly)
                </p>
              </div>
            )}
          </div>

          {/* Working Directory */}
          <div>
            <label className="text-caption font-semibold text-bot-text block mb-1.5">
              <FolderOpen className="h-3.5 w-3.5 inline mr-1.5" />
              Working Directory
            </label>
            <input
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              placeholder="Defaults to project root"
              className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-2 text-body text-bot-text font-mono placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all"
            />
          </div>

          {/* Environment Variables */}
          {envPairs.length > 0 && (
            <div>
              <label className="text-caption font-semibold text-bot-text block mb-1.5">Environment Variables</label>
              <div className="space-y-2">
                {envPairs.map((pair, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={pair.key}
                      onChange={(e) => {
                        const next = [...envPairs];
                        next[i] = { ...pair, key: e.target.value };
                        setEnvPairs(next);
                      }}
                      placeholder="KEY"
                      className="w-1/3 rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-1.5 text-caption text-bot-text font-mono placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 transition-all"
                    />
                    <input
                      value={pair.value}
                      onChange={(e) => {
                        const next = [...envPairs];
                        next[i] = { ...pair, value: e.target.value };
                        setEnvPairs(next);
                      }}
                      placeholder="value"
                      className="flex-1 rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-1.5 text-caption text-bot-text font-mono placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 transition-all"
                    />
                    <button
                      onClick={() => setEnvPairs(envPairs.filter((_, idx) => idx !== i))}
                      className="text-bot-muted hover:text-bot-red transition-colors p-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => setEnvPairs([...envPairs, { key: "", value: "" }])}
            className="text-caption text-bot-accent hover:text-bot-accent/80 transition-colors"
          >
            + Add environment variable
          </button>

          {/* Advanced Settings */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-caption font-semibold text-bot-text hover:text-bot-accent transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Advanced Settings
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")} />
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-4 rounded-xl border border-bot-border/20 bg-bot-surface/40 p-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] font-medium text-bot-muted block mb-1">Timeout (seconds)</label>
                    <input
                      type="number"
                      min={0}
                      value={timeoutSeconds}
                      onChange={(e) => setTimeoutSeconds(parseInt(e.target.value) || 0)}
                      className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-1.5 text-caption text-bot-text focus:outline-none focus:border-bot-accent/50 transition-all"
                    />
                    <p className="text-[10px] text-bot-muted mt-0.5">0 = no limit</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-bot-muted block mb-1">Max Retries</label>
                    <input
                      type="number"
                      min={0}
                      value={maxRetries}
                      onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)}
                      className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-1.5 text-caption text-bot-text focus:outline-none focus:border-bot-accent/50 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-bot-muted block mb-1">Auto-disable after</label>
                    <input
                      type="number"
                      min={0}
                      value={autoDisableAfter}
                      onChange={(e) => setAutoDisableAfter(parseInt(e.target.value) || 0)}
                      className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/30 px-3 py-1.5 text-caption text-bot-text focus:outline-none focus:border-bot-accent/50 transition-all"
                    />
                    <p className="text-[10px] text-bot-muted mt-0.5">consecutive failures (0 = never)</p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyOnFailure}
                      onChange={(e) => setNotifyOnFailure(e.target.checked)}
                      className="rounded border-bot-border accent-bot-accent"
                    />
                    <Bell className="h-3.5 w-3.5 text-bot-muted" />
                    <span className="text-caption text-bot-text">Notify on failure</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyOnSuccess}
                      onChange={(e) => setNotifyOnSuccess(e.target.checked)}
                      className="rounded border-bot-border accent-bot-accent"
                    />
                    <Bell className="h-3.5 w-3.5 text-bot-muted" />
                    <span className="text-caption text-bot-text">Notify on success</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-bot-border/30 bg-bot-bg/95 backdrop-blur-md px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-body font-medium text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className={cn(
              "rounded-xl px-6 py-2.5 text-body font-semibold text-white transition-all duration-200",
              isValid
                ? "gradient-accent shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98]"
                : "bg-bot-muted/30 cursor-not-allowed",
            )}
          >
            {isEditing ? "Save Changes" : "Create Job"}
          </button>
        </div>
      </div>
    </div>
  );
}
