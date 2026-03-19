"use client";

import { useState } from "react";
import { Send, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlanQACardProps {
  question: string;
  options?: string[];
  round: number;
  onAnswer: (text: string) => void;
  onSkip: () => void;
  disabled?: boolean;
}

export function PlanQACard({
  question,
  options,
  round,
  onAnswer,
  onSkip,
  disabled,
}: PlanQACardProps) {
  const [answer, setAnswer] = useState("");

  const handleSubmit = () => {
    if (!answer.trim() || disabled) return;
    onAnswer(answer.trim());
    setAnswer("");
  };

  return (
    <div className="w-full max-w-2xl animate-fadeUp">
      <div className="rounded-2xl border border-bot-accent/30 bg-bot-surface/60 backdrop-blur-sm shadow-glow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bot-border/30 px-5 py-3">
          <span className="text-caption font-semibold text-bot-accent">
            Question {round} of up to 5
          </span>
          <button
            onClick={onSkip}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-xl border border-bot-border/40 px-3 py-1.5 text-caption text-bot-muted hover:border-bot-accent/30 hover:text-bot-text disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
          >
            <SkipForward className="h-3.5 w-3.5" />
            You figure out the rest
          </button>
        </div>

        {/* Question */}
        <div className="px-5 pt-4 pb-3">
          <p className="text-body text-bot-text leading-relaxed">{question}</p>
        </div>

        {/* Option chips */}
        {options && options.length > 0 && (
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => { if (!disabled) onAnswer(opt); }}
                disabled={disabled}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-caption transition-all duration-150",
                  answer === opt
                    ? "border-bot-accent/50 bg-bot-accent/10 text-bot-accent"
                    : "border-bot-border/40 bg-bot-surface/40 text-bot-muted hover:border-bot-accent/30 hover:text-bot-text",
                  disabled && "opacity-40 cursor-not-allowed",
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Answer input */}
        <div className="flex items-center gap-3 border-t border-bot-border/30 px-4 py-3">
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={disabled}
            placeholder="Type your answer..."
            className="flex-1 bg-transparent text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!answer.trim() || disabled}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-bot-muted hover:bg-bot-accent/15 hover:text-bot-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
            title="Submit answer"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
