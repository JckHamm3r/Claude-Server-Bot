export interface ModelInfo {
  value: string;
  label: string;
  description: string;
  contextWindow: number;
  tier: "most-capable" | "balanced" | "fastest";
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    value: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    description: "Most capable — complex reasoning & long tasks",
    contextWindow: 1_000_000,
    tier: "most-capable",
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Balanced — great performance at lower cost",
    contextWindow: 1_000_000,
    tier: "balanced",
  },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    description: "Fastest — quick tasks and simple questions",
    contextWindow: 200_000,
    tier: "fastest",
  },
];

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export function getModelLabel(value: string): string {
  return AVAILABLE_MODELS.find((m) => m.value === value)?.label ?? value;
}

export function getModelContextWindow(value: string): number {
  return AVAILABLE_MODELS.find((m) => m.value === value)?.contextWindow ?? 200_000;
}
