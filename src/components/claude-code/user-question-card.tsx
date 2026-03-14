"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { MessageCircleQuestion, Check } from "lucide-react";
import type { UserQuestion } from "@/lib/claude/provider";

interface UserQuestionCardProps {
  questions: UserQuestion[];
  sessionId: string;
  onAnswer: (sessionId: string, answers: string) => void;
  disabled?: boolean;
}

export function UserQuestionCard({ questions, sessionId, onAnswer, disabled }: UserQuestionCardProps) {
  const [selections, setSelections] = useState<Map<number, Set<number>>>(new Map());
  const [submitted, setSubmitted] = useState(false);

  const toggleOption = useCallback((questionIdx: number, optionIdx: number, multiSelect: boolean) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(questionIdx) ?? []);
      if (multiSelect) {
        if (current.has(optionIdx)) {
          current.delete(optionIdx);
        } else {
          current.add(optionIdx);
        }
      } else {
        current.clear();
        current.add(optionIdx);
      }
      next.set(questionIdx, current);
      return next;
    });
  }, []);

  const allAnswered = questions.every((_, idx) => {
    const selected = selections.get(idx);
    return selected && selected.size > 0;
  });

  const handleSubmit = useCallback(() => {
    if (!allAnswered || submitted) return;
    setSubmitted(true);

    const parts: string[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const selected = selections.get(i) ?? new Set();
      const answers = Array.from(selected).map((idx) => q.options[idx]?.label).filter(Boolean);
      if (questions.length > 1) {
        parts.push(`${q.header ?? q.question}: ${answers.join(", ")}`);
      } else {
        parts.push(answers.join(", "));
      }
    }

    onAnswer(sessionId, parts.join("\n"));
  }, [allAnswered, submitted, questions, selections, sessionId, onAnswer]);

  return (
    <div className="rounded-lg border border-bot-accent/30 bg-bot-accent/5 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bot-accent/20 bg-bot-accent/10">
        <MessageCircleQuestion className="h-4 w-4 text-bot-accent" />
        <span className="text-body font-medium text-bot-text">Claude has some questions</span>
      </div>

      <div className="divide-y divide-bot-border/30">
        {questions.map((q, qIdx) => {
          const selected = selections.get(qIdx) ?? new Set();
          return (
            <div key={qIdx} className="px-4 py-3 space-y-2">
              {q.header && (
                <p className="text-caption font-semibold text-bot-accent uppercase tracking-wide">{q.header}</p>
              )}
              <p className="text-body text-bot-text">{q.question}</p>
              {q.multiSelect && (
                <p className="text-caption text-bot-muted italic">Select all that apply</p>
              )}
              <div className="space-y-1.5 pt-1">
                {q.options.map((opt, oIdx) => {
                  const isSelected = selected.has(oIdx);
                  return (
                    <button
                      key={oIdx}
                      onClick={() => !disabled && !submitted && toggleOption(qIdx, oIdx, q.multiSelect ?? false)}
                      disabled={disabled || submitted}
                      className={cn(
                        "w-full text-left rounded-lg border px-3 py-2.5 transition-all",
                        "hover:border-bot-accent/60 hover:bg-bot-accent/10",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        isSelected
                          ? "border-bot-accent bg-bot-accent/15 ring-1 ring-bot-accent/30"
                          : "border-bot-border/60 bg-bot-elevated",
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={cn(
                          "mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded transition-colors",
                          q.multiSelect ? "rounded-sm" : "rounded-full",
                          isSelected
                            ? "bg-bot-accent text-white"
                            : "border border-bot-border bg-bot-surface",
                        )}>
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn(
                            "text-body font-medium",
                            isSelected ? "text-bot-accent" : "text-bot-text",
                          )}>
                            {opt.label}
                          </p>
                          {opt.description && (
                            <p className="text-caption text-bot-muted mt-0.5">{opt.description}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 border-t border-bot-accent/20 bg-bot-surface/50">
        <button
          onClick={handleSubmit}
          disabled={!allAnswered || disabled || submitted}
          className={cn(
            "rounded-lg px-5 py-2 text-body font-medium text-white transition-all",
            allAnswered && !submitted
              ? "bg-bot-accent hover:bg-bot-accent/80 shadow-sm"
              : "bg-bot-muted/30 cursor-not-allowed",
          )}
        >
          {submitted ? "Submitted" : "Submit Answers"}
        </button>
      </div>
    </div>
  );
}
