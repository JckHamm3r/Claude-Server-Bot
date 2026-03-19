"use client";

import { Zap, CheckCircle2, DollarSign, Clock } from "lucide-react";

export interface AgentStats {
  agentId: string;
  total_invocations: number;
  successful_invocations: number;
  success_rate: number;
  total_cost_usd: number;
  last_invoked_at: string | null;
}

interface AgentStatsRowProps {
  stats: AgentStats | undefined;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso + "Z").getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function AgentStatsRow({ stats }: AgentStatsRowProps) {
  if (!stats || stats.total_invocations === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[10.5px] text-bot-muted/40 italic">
        No invocations yet
      </div>
    );
  }

  const successPct = Math.round(stats.success_rate * 100);
  const costStr = stats.total_cost_usd < 0.01
    ? `$${stats.total_cost_usd.toFixed(4)}`
    : `$${stats.total_cost_usd.toFixed(2)}`;

  return (
    <div className="flex items-center gap-3 text-[10.5px] text-bot-muted/60">
      <span className="flex items-center gap-1" title="Total invocations">
        <Zap className="h-3 w-3" />
        {stats.total_invocations}
      </span>
      <span
        className={`flex items-center gap-1 ${successPct >= 80 ? "text-bot-green/70" : successPct >= 50 ? "text-bot-amber/70" : "text-bot-red/70"}`}
        title="Success rate"
      >
        <CheckCircle2 className="h-3 w-3" />
        {successPct}%
      </span>
      <span className="flex items-center gap-1" title="Total cost">
        <DollarSign className="h-3 w-3" />
        {costStr}
      </span>
      {stats.last_invoked_at && (
        <span className="flex items-center gap-1" title={`Last invoked: ${stats.last_invoked_at}`}>
          <Clock className="h-3 w-3" />
          {relativeTime(stats.last_invoked_at)}
        </span>
      )}
    </div>
  );
}
