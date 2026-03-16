"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, X, CheckCheck } from "lucide-react";
import { getSocket, connectSocket } from "@/lib/socket";
import { apiUrl } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface InAppNotification {
  id: number;
  event_type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/notifications?limit=20"));
      if (!res.ok) return;
      const data = await res.json() as { notifications: InAppNotification[]; unread: number };
      setNotifications(data.notifications);
      setUnread(data.unread);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const markAllRead = async () => {
    try {
      await fetch(apiUrl("/api/notifications"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch {
      // ignore
    }
  };

  // Socket listeners for real-time updates
  useEffect(() => {
    const socket = getSocket();
    connectSocket();

    const handleNew = ({ notification }: { notification: InAppNotification }) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 20));
      setUnread((c) => c + 1);
    };

    const handleCount = ({ unread: count }: { unread: number }) => {
      setUnread(count);
    };

    socket.on("notification:new", handleNew);
    socket.on("notification:count", handleCount);

    // Load initial unread count
    fetchNotifications();

    return () => {
      socket.off("notification:new", handleNew);
      socket.off("notification:count", handleCount);
    };
  }, [fetchNotifications]);

  // Mark as read when dropdown opens
  useEffect(() => {
    if (open && unread > 0) {
      markAllRead();
    }
    if (open && notifications.length === 0) {
      fetchNotifications();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center rounded-lg p-2 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-colors duration-200"
      >
        <Bell className="h-4.5 w-4.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-bot-accent text-[10px] font-bold text-white shadow-glow-sm">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-80 rounded-xl border border-bot-border bg-bot-surface shadow-glass overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-bot-border/60">
            <h3 className="text-body font-semibold text-bot-text">Notifications</h3>
            <div className="flex items-center gap-1">
              {notifications.some((n) => !n.read) && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-caption text-bot-muted hover:text-bot-accent hover:bg-bot-elevated/40 transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="py-8 text-center text-caption text-bot-muted">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-caption text-bot-muted">No notifications yet</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "px-4 py-3 border-b border-bot-border/40 last:border-0 transition-colors",
                    !n.read && "bg-bot-accent/5"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-bot-accent" />
                    )}
                    <div className={cn("flex-1", n.read && "pl-3.5")}>
                      <p className="text-body font-medium text-bot-text leading-snug">{n.title}</p>
                      {n.body && (
                        <p className="text-caption text-bot-muted mt-0.5 leading-snug">{n.body}</p>
                      )}
                      <p className="text-caption text-bot-muted/60 mt-1">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
