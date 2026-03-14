"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  visible: boolean;
  exiting: boolean;
  createdAt: number;
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 5000;

const typeConfig: Record<ToastType, { border: string; icon: string; color: string }> = {
  info: { border: "border-l-bot-accent", icon: "ℹ", color: "text-bot-accent" },
  success: { border: "border-l-bot-green", icon: "✓", color: "text-bot-green" },
  warning: { border: "border-l-bot-amber", icon: "⚠", color: "text-bot-amber" },
  error: { border: "border-l-bot-red", icon: "✕", color: "text-bot-red" },
};

function ToastItemComponent({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [entered, setEntered] = useState(false);
  const [progress, setProgress] = useState(100);
  const handleClick = useCallback(() => onDismiss(item.id), [item.id, onDismiss]);
  const config = typeConfig[item.type];

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (item.duration <= 0) return;
    const start = item.createdAt;
    const end = start + item.duration;
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, (end - now) / item.duration) * 100;
      setProgress(remaining);
      if (remaining > 0 && !item.exiting) {
        requestAnimationFrame(tick);
      }
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [item.duration, item.createdAt, item.exiting]);

  return (
    <div
      role="alert"
      onClick={handleClick}
      className={`
        relative cursor-pointer overflow-hidden rounded-xl border border-bot-border/30 border-l-[3px] ${config.border}
        glass-heavy shadow-float
        transition-all duration-300 ease-out
        ${item.exiting ? "translate-x-full opacity-0" : !entered ? "translate-x-full opacity-0" : "translate-x-0 opacity-100"}
      `}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`shrink-0 font-bold text-body ${config.color}`}>
          {config.icon}
        </span>
        <span className="flex-1 text-body text-bot-text">{item.message}</span>
      </div>
      {item.duration > 0 && (
        <div className="absolute bottom-0 left-0 h-0.5 bg-bot-border/20 w-full">
          <div
            className={`h-full transition-none ${
              item.type === "error" ? "bg-bot-red/40"
              : item.type === "success" ? "bg-bot-green/40"
              : item.type === "warning" ? "bg-bot-amber/40"
              : "bg-bot-accent/40"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => {
      const item = prev.find((t) => t.id === id);
      if (!item) return prev;
      return prev.map((t) =>
        t.id === id ? { ...t, exiting: true } : t
      );
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const toast = useCallback(
    (message: string, options?: ToastOptions) => {
      const type = options?.type ?? "info";
      const duration = options?.duration ?? DEFAULT_DURATION;
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const item: ToastItem = {
        id,
        message,
        type,
        duration,
        visible: true,
        exiting: false,
        createdAt: Date.now(),
      };

      setToasts((prev) => [...prev, item].slice(-MAX_VISIBLE));

      if (duration > 0) {
        setTimeout(() => removeToast(id), duration);
      }
    },
    [removeToast]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col gap-2.5 w-80"
        style={{ pointerEvents: "none" }}
      >
        <div
          className="flex flex-col gap-2.5"
          style={{ pointerEvents: "auto" }}
        >
          {toasts.map((item) => (
            <ToastItemComponent
              key={item.id}
              item={item}
              onDismiss={removeToast}
            />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
