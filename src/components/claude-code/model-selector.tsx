"use client";

import { cn } from "@/lib/utils";
import { AVAILABLE_MODELS } from "@/lib/models";
import { ChevronDown, Cpu } from "lucide-react";

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  compact?: boolean;
  disabled?: boolean;
}

export function ModelSelector({ value, onChange, compact, disabled }: ModelSelectorProps) {
  return (
    <div className="relative inline-flex items-center">
      {compact && (
        <Cpu className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-bot-accent/60 pointer-events-none" />
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          "appearance-none rounded-xl border border-bot-border/40 bg-bot-elevated/40 text-bot-text outline-none focus:border-bot-accent/50 focus:shadow-glow-sm transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
          compact
            ? "pl-7 pr-8 py-1.5 text-caption font-medium"
            : "px-4 pr-9 py-2.5 text-body",
        )}
      >
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <ChevronDown className={cn(
        "pointer-events-none absolute top-1/2 -translate-y-1/2 text-bot-muted/60",
        compact ? "right-2.5 h-3 w-3" : "right-3 h-3.5 w-3.5",
      )} />
    </div>
  );
}
