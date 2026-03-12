"use client";

interface OptionsButtonsProps {
  choices: string[];
  onSelect: (choice: string, index: number) => void;
  disabled?: boolean;
}

export function OptionsButtons({ choices, onSelect, disabled }: OptionsButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {choices.map((choice, i) => (
        <button
          key={i}
          onClick={() => onSelect(choice, i + 1)}
          disabled={disabled}
          className="rounded-md border border-bot-border bg-bot-elevated px-3 py-1.5 text-body text-bot-text hover:border-bot-accent hover:text-bot-accent disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          <span className="font-mono text-caption text-bot-muted mr-1.5">{i + 1}.</span>
          {choice}
        </button>
      ))}
    </div>
  );
}
