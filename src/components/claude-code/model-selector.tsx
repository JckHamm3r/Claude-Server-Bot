"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { AVAILABLE_MODELS } from "@/lib/models";
import { ChevronDown, Zap, Scale, Brain } from "lucide-react";

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  compact?: boolean;
  disabled?: boolean;
}

const TIER_ICONS = {
  "most-capable": Brain,
  "balanced": Scale,
  "fastest": Zap,
};

const TIER_COLORS = {
  "most-capable": "text-bot-accent",
  "balanced": "text-bot-green",
  "fastest": "text-bot-amber",
};

export function ModelSelector({ value, onChange, compact, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = AVAILABLE_MODELS.find((m) => m.value === value) ?? AVAILABLE_MODELS[0];
  const Icon = TIER_ICONS[selected.tier];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (compact) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => !disabled && setOpen((v) => !v)}
          disabled={disabled}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border border-bot-border/40 bg-bot-elevated/40 pl-2.5 pr-2 py-1.5 text-caption font-medium text-bot-text transition-all duration-200",
            disabled ? "opacity-40 cursor-not-allowed" : "hover:border-bot-accent/40 hover:bg-bot-elevated/60 cursor-pointer",
          )}
        >
          <Icon className={cn("h-3 w-3 shrink-0", TIER_COLORS[selected.tier])} />
          <span>{selected.label}</span>
          <ChevronDown className={cn("h-3 w-3 text-bot-muted/60 transition-transform duration-200", open && "rotate-180")} />
        </button>
        {open && (
          <ModelDropdown value={value} onChange={(v) => { onChange(v); setOpen(false); }} />
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-3 text-left text-body text-bot-text transition-all duration-200",
          disabled ? "opacity-40 cursor-not-allowed" : "hover:border-bot-accent/40 hover:bg-bot-elevated/60 cursor-pointer",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", TIER_COLORS[selected.tier])} />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{selected.label}</div>
          <div className="text-caption text-bot-muted truncate">{selected.description}</div>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-bot-muted/60 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <ModelDropdown value={value} onChange={(v) => { onChange(v); setOpen(false); }} />
      )}
    </div>
  );
}

function ModelDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="absolute z-50 left-0 right-0 top-full mt-1.5 rounded-xl border border-bot-border bg-bot-surface shadow-float overflow-hidden">
      {AVAILABLE_MODELS.map((m) => {
        const Icon = TIER_ICONS[m.tier];
        const isSelected = m.value === value;
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange(m.value)}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150",
              isSelected
                ? "bg-bot-accent/10"
                : "hover:bg-bot-elevated/60",
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", TIER_COLORS[m.tier])} />
            <div className="flex-1 min-w-0">
              <div className={cn("text-body font-medium", isSelected ? "text-bot-accent" : "text-bot-text")}>
                {m.label}
              </div>
              <div className="text-caption text-bot-muted truncate">{m.description}</div>
            </div>
            {isSelected && (
              <div className="h-2 w-2 rounded-full bg-bot-accent shrink-0" />
            )}
          </button>
        );
      })}
    </div>
  );
}
