import type { ParsedOutput } from "@/lib/claude/provider";

export interface ChatMessage {
  id: string;
  sender_type: "admin" | "claude";
  sender_id?: string | null;
  content?: string;
  parsed?: ParsedOutput;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface SessionUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

export interface SearchResult {
  messageId: string;
  sessionId: string;
  sessionName: string | null;
  senderType: string;
  content: string;
  snippet: string;
  timestamp: string;
}

export interface BudgetLimits {
  session_usd: number;
  daily_usd: number;
  monthly_usd: number;
}

export interface ContextUsage {
  inputTokens: number;
  contextWindow: number;
  percentage: number;
}
