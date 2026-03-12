"use client";

interface ConfirmButtonsProps {
  prompt: string;
  onConfirm: (value: boolean) => void;
  disabled?: boolean;
}

export function ConfirmButtons({ prompt, onConfirm, disabled }: ConfirmButtonsProps) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-body text-bot-muted">{prompt}</span>
      <button
        onClick={() => onConfirm(true)}
        disabled={disabled}
        className="rounded-md bg-bot-accent px-4 py-1.5 text-body font-medium text-white hover:bg-bot-accent/80 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        Yes
      </button>
      <button
        onClick={() => onConfirm(false)}
        disabled={disabled}
        className="rounded-md border border-bot-border px-4 py-1.5 text-body font-medium text-bot-muted hover:bg-bot-elevated disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        No
      </button>
    </div>
  );
}
