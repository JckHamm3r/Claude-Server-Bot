export const AVAILABLE_MODELS = [
  { value: "claude-opus-4-6", label: "Claude Opus 4.6", contextWindow: 200_000 },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextWindow: 200_000 },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", contextWindow: 200_000 },
];

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export function getModelLabel(value: string): string {
  return AVAILABLE_MODELS.find((m) => m.value === value)?.label ?? value;
}

export function getModelContextWindow(value: string): number {
  return AVAILABLE_MODELS.find((m) => m.value === value)?.contextWindow ?? 200_000;
}
