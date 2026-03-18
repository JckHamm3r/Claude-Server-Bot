"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";

interface TransformerLogViewerProps {
  transformerId: string;
  transformerName: string;
}

function classifyLine(line: string): "error" | "warn" | "info" | "default" {
  if (/\[ERROR\]/i.test(line)) return "error";
  if (/\[WARN\]/i.test(line)) return "warn";
  if (/\[INFO\]/i.test(line)) return "info";
  return "default";
}

function lineClass(level: ReturnType<typeof classifyLine>): string {
  switch (level) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-400";
    case "info":
      return "text-green-400/80";
    default:
      return "text-bot-muted";
  }
}

export function TransformerLogViewer({ transformerId, transformerName }: TransformerLogViewerProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/transformers/${encodeURIComponent(transformerId)}/logs`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { logs: string[]; transformer_id: string };
      setLogs(data.logs ?? []);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [transformerId]);

  // Initial load
  useEffect(() => {
    fetchLogs(false);
  }, [fetchLogs]);

  // Auto-refresh every 5 s
  useEffect(() => {
    intervalRef.current = setInterval(() => fetchLogs(true), 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchLogs]);

  // Scroll to bottom when logs update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-bot-muted font-mono">
          Logs — {transformerName}
          {lastRefreshed && (
            <span className="ml-2 opacity-50">
              updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
        </span>
        <button
          onClick={() => fetchLogs(false)}
          disabled={loading}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Terminal box */}
      <div className="relative rounded-md border border-bot-border bg-bot-elevated overflow-hidden">
        <div className="h-64 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
          {error ? (
            <span className="text-red-400">Error: {error}</span>
          ) : loading ? (
            <span className="text-bot-muted animate-pulse">Loading logs…</span>
          ) : logs.length === 0 ? (
            <span className="text-bot-muted italic">No logs yet.</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={lineClass(classifyLine(line))}>
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
