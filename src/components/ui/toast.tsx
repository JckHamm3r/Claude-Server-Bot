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
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 5000;

const typeStyles: Record<ToastType, string> = {
  info: "text-bot-accent",
  success: "text-bot-green",
  warning: "text-bot-amber",
  error: "text-bot-red",
};

function ToastItemComponent({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [entered, setEntered] = useState(false);
  const handleClick = useCallback(() => onDismiss(item.id), [item.id, onDismiss]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      role="alert"
      onClick={handleClick}
      className={`
        flex cursor-pointer items-center gap-2 rounded-xl border border-bot-border bg-bot-elevated px-4 py-3 text-body text-bot-text shadow-lg
        transition-all duration-300 ease-out
        ${item.exiting ? "translate-x-full opacity-0" : !entered ? "translate-x-full opacity-0" : "translate-x-0 opacity-100"}
      `}
    >
      <span className={`shrink-0 font-semibold ${typeStyles[item.type]}`}>
        {item.type === "info" && "ℹ"}
        {item.type === "success" && "✓"}
        {item.type === "warning" && "⚠"}
        {item.type === "error" && "✕"}
      </span>
      <span className="flex-1">{item.message}</span>
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
        className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col gap-2"
        style={{ pointerEvents: "none" }}
      >
        <div
          className="flex flex-col gap-2"
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
