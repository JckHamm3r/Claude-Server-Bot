"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";

interface TriggerPhraseInputProps {
  value: string[];
  onChange: (phrases: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function TriggerPhraseInput({ value, onChange, placeholder = "Type and press Enter…", disabled }: TriggerPhraseInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addPhrase = (text: string) => {
    const trimmed = text.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setDraft("");
  };

  const removePhrase = (phrase: string) => {
    onChange(value.filter((p) => p !== phrase));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
      e.preventDefault();
      addPhrase(draft);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      removePhrase(value[value.length - 1]);
    }
  };

  return (
    <div
      className="flex flex-wrap gap-1.5 rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-3 py-2 min-h-[40px] focus-within:border-bot-accent/50 focus-within:shadow-glow-sm transition-all duration-200 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((phrase) => (
        <span
          key={phrase}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 bg-bot-accent/10 border border-bot-accent/25 text-bot-accent text-[11px] font-medium"
        >
          {phrase}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removePhrase(phrase); }}
              className="p-0.5 rounded-full hover:bg-bot-accent/20 transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (draft.trim()) addPhrase(draft); }}
        placeholder={value.length === 0 ? placeholder : ""}
        disabled={disabled}
        className="flex-1 min-w-[80px] bg-transparent text-[12px] text-bot-text placeholder:text-bot-muted/40 outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
