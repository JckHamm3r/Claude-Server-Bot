"use client";

import { cn } from "@/lib/utils";
import type { ConfigFieldDef } from "@/lib/transformer-types";

interface TransformerConfigEditorProps {
  configSchema: Record<string, ConfigFieldDef>;
  values: Record<string, string | number | boolean | string[]>;
  onChange: (key: string, value: string | number | boolean | string[]) => void;
}

export function TransformerConfigEditor({
  configSchema,
  values,
  onChange,
}: TransformerConfigEditorProps) {
  const entries = Object.entries(configSchema);
  if (entries.length === 0) return null;

  const inputBase =
    "w-full rounded-lg border border-bot-border bg-bot-bg px-3 py-2 text-sm text-bot-text placeholder-bot-muted/50 focus:outline-none focus:ring-1 focus:ring-bot-accent/50 transition-colors";

  return (
    <div className="space-y-4">
      {entries.map(([key, field]) => {
        const value = values[key] ?? field.default ?? "";

        return (
          <div key={key} className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-bot-text">
              {field.label}
              {field.required && (
                <span className="text-bot-red text-[10px]">*</span>
              )}
            </label>

            {field.description && (
              <p className="text-[11px] text-bot-muted leading-relaxed">
                {field.description}
              </p>
            )}

            {(field.type === "string" || field.type === "password") && (
              <input
                type={field.type === "password" ? "password" : "text"}
                value={typeof value === "string" ? value : String(value)}
                placeholder={field.placeholder}
                onChange={(e) => onChange(key, e.target.value)}
                className={inputBase}
              />
            )}

            {field.type === "text" && (
              <textarea
                value={typeof value === "string" ? value : String(value)}
                placeholder={field.placeholder}
                onChange={(e) => onChange(key, e.target.value)}
                rows={3}
                className={cn(inputBase, "resize-y")}
              />
            )}

            {field.type === "number" && (
              <input
                type="number"
                value={typeof value === "number" ? value : Number(value)}
                placeholder={field.placeholder}
                onChange={(e) => onChange(key, e.target.valueAsNumber)}
                className={inputBase}
              />
            )}

            {field.type === "boolean" && (
              <button
                type="button"
                role="switch"
                aria-checked={!!value}
                onClick={() => onChange(key, !value)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-bot-accent/50 focus:ring-offset-2 focus:ring-offset-bot-bg",
                  value ? "bg-bot-accent" : "bg-bot-border"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
                    value ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            )}

            {field.type === "select" && field.options && (
              <select
                value={typeof value === "string" ? value : String(value)}
                onChange={(e) => onChange(key, e.target.value)}
                className={cn(inputBase, "cursor-pointer")}
              >
                {!field.required && (
                  <option value="">
                    {field.placeholder ?? "Select an option"}
                  </option>
                )}
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {field.type === "multi-select" && field.options && (
              <div className="space-y-1.5">
                {field.options.map((opt) => {
                  const selected = Array.isArray(value)
                    ? value.includes(opt)
                    : false;
                  return (
                    <label
                      key={opt}
                      className="flex items-center gap-2 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          const current = Array.isArray(value) ? [...value] : [];
                          if (e.target.checked) {
                            onChange(key, [...current, opt]);
                          } else {
                            onChange(key, current.filter((v) => v !== opt));
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-bot-border bg-bot-bg accent-bot-accent"
                      />
                      <span className="text-xs text-bot-muted group-hover:text-bot-text transition-colors">
                        {opt}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
