"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/utils";
import type { SystemdUnit } from "./system-service-manager-section";

export interface ServiceDetailMetrics {
  MemoryCurrent?: string;
  CPUUsageNSec?: string;
  MainPID?: string;
  [key: string]: string | undefined;
}

interface DataPoint {
  ts: number;
  memBytes: number;
  cpuMs: number;
}

const MAX_POINTS = 30;
const POLL_INTERVAL = 5000;

function formatMemory(bytes: number): string {
  if (bytes <= 0 || bytes === 18446744073709552000) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Sparkline({
  data,
  color,
  height = 60,
  label,
  current,
}: {
  data: number[];
  color: string;
  height?: number;
  label: string;
  current: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (data.length < 2) {
      ctx.fillStyle = "rgba(128,128,128,0.15)";
      ctx.fillRect(0, 0, W, H);
      return;
    }

    const max = Math.max(...data, 1);
    const min = 0;
    const range = max - min || 1;

    const step = W / (data.length - 1);
    const points = data.map((v, i) => ({
      x: i * step,
      y: H - ((v - min) / range) * H * 0.9 - H * 0.05,
    }));

    // Fill gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color.replace("1)", "0.3)").replace("#", "rgba(").replace("var(--", "rgba("));
    grad.addColorStop(1, "rgba(0,0,0,0)");

    // Parse color for gradient
    ctx.beginPath();
    ctx.moveTo(points[0].x, H);
    ctx.lineTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const cp = (points[i - 1].x + points[i].x) / 2;
      ctx.bezierCurveTo(cp, points[i - 1].y, cp, points[i].y, points[i].x, points[i].y);
    }
    ctx.lineTo(points[points.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const cp = (points[i - 1].x + points[i].x) / 2;
      ctx.bezierCurveTo(cp, points[i - 1].y, cp, points[i].y, points[i].x, points[i].y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Current point dot
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [data, color, height]);

  return (
    <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-caption text-bot-muted font-medium">{label}</span>
        <span className="text-body font-bold text-bot-text font-mono">{current}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={500}
        height={height}
        className="w-full rounded-md bg-bot-elevated/30"
        style={{ height: `${height}px` }}
      />
      <p className="text-caption text-bot-muted/50 mt-1.5">Last {data.length} samples · 5s interval</p>
    </div>
  );
}

export function SparklineChart({ unit, detail }: { unit: SystemdUnit; detail: ServiceDetailMetrics | null }) {
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [pid, setPid] = useState<string>("");

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/system/services/${encodeURIComponent(unit.unit)}?type=${unit.type}`));
      if (!res.ok) return;
      const d = await res.json() as ServiceDetailMetrics;

      const memBytes = parseInt(d.MemoryCurrent ?? "0", 10);
      const cpuNs = parseInt(d.CPUUsageNSec ?? "0", 10);
      const cpuMs = cpuNs > 0 ? cpuNs / 1_000_000 : 0;
      if (d.MainPID && d.MainPID !== "0") setPid(d.MainPID);

      setHistory((prev) => {
        const next = [...prev, { ts: Date.now(), memBytes, cpuMs }];
        return next.slice(-MAX_POINTS);
      });
    } catch {
      // ignore
    }
  }, [unit.unit, unit.type]);

  useEffect(() => {
    setLoading(true);
    fetchMetrics().finally(() => setLoading(false));
    const t = setInterval(fetchMetrics, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetchMetrics]);

  // Seed with detail if available
  useEffect(() => {
    if (detail && history.length === 0) {
      const memBytes = parseInt(detail.MemoryCurrent ?? "0", 10);
      const cpuNs = parseInt(detail.CPUUsageNSec ?? "0", 10);
      const cpuMs = cpuNs > 0 ? cpuNs / 1_000_000 : 0;
      setHistory([{ ts: Date.now(), memBytes, cpuMs }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const memData = history.map((p) => p.memBytes);
  const cpuData = history.map((p) => p.cpuMs);

  const currentMem = history[history.length - 1]?.memBytes ?? 0;
  const currentCpu = history[history.length - 1]?.cpuMs ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-body font-semibold text-bot-text">Resource Usage</h3>
        <div className="flex items-center gap-2 text-caption text-bot-muted">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>Auto-refresh every 5s</span>
        </div>
      </div>

      {pid && (
        <div className="text-caption text-bot-muted">
          PID: <span className="font-mono text-bot-text">{pid}</span>
        </div>
      )}

      <Sparkline
        data={memData}
        color="rgb(99, 179, 237)"
        height={80}
        label="Memory"
        current={formatMemory(currentMem)}
      />

      <Sparkline
        data={cpuData}
        color="rgb(104, 211, 145)"
        height={80}
        label="CPU Time (cumulative)"
        current={currentCpu > 0 ? `${(currentCpu / 1000).toFixed(2)}s` : "—"}
      />

      {history.length < 2 && !loading && (
        <p className="text-caption text-bot-muted/60 text-center py-4">
          Collecting data… chart will populate as samples arrive.
        </p>
      )}
    </div>
  );
}
