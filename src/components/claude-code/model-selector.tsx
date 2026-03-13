"use client";

import { cn } from "@/lib/utils";
import { AVAILABLE_MODELS } from "@/lib/models";
import { ChevronDown } from "lucide-react";

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  compact?: boolean;
  disabled?: boolean;
}

export function ModelSelector({ value, onChange, compact, disabled }: ModelSelectorProps) {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          "appearance-none rounded-md border border-bot-border bg-bot-elevated text-bot-text outline-none focus:border-bot-accent transition-colors pr-7 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
          compact
            ? "px-2 py-1 text-caption"
            : "px-3 py-2 text-body",
        )}
      >
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <ChevronDown className={cn(
        "pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-bot-muted",
        compact ? "h-3 w-3" : "h-3.5 w-3.5",
      )} />
    </div>
  );
}
