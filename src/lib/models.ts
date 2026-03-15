export const AVAILABLE_MODELS = [
  { value: "claude-opus-4-6", label: "Claude Opus 4.6", costPer1kInput: 0.005, costPer1kOutput: 0.025, contextWindow: 200_000 },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", costPer1kInput: 0.003, costPer1kOutput: 0.015, contextWindow: 200_000 },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", costPer1kInput: 0.001, costPer1kOutput: 0.005, contextWindow: 200_000 },
];

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export function getModelLabel(value: string): string {
  return AVAILABLE_MODELS.find((m) => m.value === value)?.label ?? value;
}

export function getModelCost(value: string): { costPer1kInput: number; costPer1kOutput: number } {
  const model = AVAILABLE_MODELS.find((m) => m.value === value);
  return model ?? { costPer1kInput: 0.003, costPer1kOutput: 0.015 };
}

export function getModelContextWindow(value: string): number {
  return AVAILABLE_MODELS.find((m) => m.value === value)?.contextWindow ?? 200_000;
}
