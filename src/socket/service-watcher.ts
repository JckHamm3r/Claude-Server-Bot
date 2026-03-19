import type { Server } from "socket.io";
import { execFileSync } from "child_process";

export interface ServiceWatchState {
  interval: NodeJS.Timeout | null;
  subscribers: Set<string>;
  // unit name -> { active, sub }
  lastKnown: Map<string, { active: string; sub: string }>;
}

const watchState: ServiceWatchState = {
  interval: null,
  subscribers: new Set(),
  lastKnown: new Map(),
};

const POLL_INTERVAL_MS = 10_000;

function getUnitStates(): Map<string, { active: string; sub: string }> {
  const result = new Map<string, { active: string; sub: string }>();
  try {
    const out = execFileSync(
      "systemctl",
      ["list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend"],
      { encoding: "utf8", timeout: 8000 },
    );
    for (const line of out.split("\n")) {
      const trimmed = line.trimStart();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4 || !parts[0].endsWith(".service")) continue;
      result.set(parts[0], { active: parts[2], sub: parts[3] });
    }
  } catch {
    // systemctl not available
  }
  return result;
}

export function startServiceWatcher(io: Server) {
  if (watchState.interval) return;
  watchState.lastKnown = getUnitStates();

  watchState.interval = setInterval(() => {
    // Only poll if there are subscribers
    if (watchState.subscribers.size === 0) return;

    const current = getUnitStates();

    const changes: { unit: string; active: string; sub: string }[] = [];
    const failed: string[] = [];

    for (const [unit, state] of current.entries()) {
      const prev = watchState.lastKnown.get(unit);
      if (!prev || prev.active !== state.active || prev.sub !== state.sub) {
        changes.push({ unit, active: state.active, sub: state.sub });
        if (state.active === "failed") failed.push(unit);
      }
    }

    // Detect units that disappeared
    for (const unit of watchState.lastKnown.keys()) {
      if (!current.has(unit)) {
        changes.push({ unit, active: "inactive", sub: "dead" });
      }
    }

    watchState.lastKnown = current;

    if (changes.length > 0) {
      io.to("system:services").emit("system:service_status_changed", { changes });
    }

    // Count total failed units and broadcast summary
    const totalFailed = Array.from(current.values()).filter((s) => s.active === "failed").length;
    if (changes.length > 0) {
      io.to("system:services").emit("system:services_summary", { totalFailed });
    }
  }, POLL_INTERVAL_MS);
}

export function stopServiceWatcher() {
  if (watchState.interval) {
    clearInterval(watchState.interval);
    watchState.interval = null;
  }
}

export function registerServiceWatcherHandlers(io: Server) {
  startServiceWatcher(io);

  io.on("connection", (socket) => {
    socket.on("system:subscribe_services", () => {
      socket.join("system:services");
      watchState.subscribers.add(socket.id);

      // Send current summary immediately
      const totalFailed = Array.from(watchState.lastKnown.values()).filter(
        (s) => s.active === "failed",
      ).length;
      socket.emit("system:services_summary", { totalFailed });
    });

    socket.on("system:unsubscribe_services", () => {
      socket.leave("system:services");
      watchState.subscribers.delete(socket.id);
    });

    socket.on("disconnect", () => {
      watchState.subscribers.delete(socket.id);
    });
  });
}
