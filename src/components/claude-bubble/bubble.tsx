"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import Image from "next/image";
import { getSocket } from "@/lib/socket";
import { getAvatarPath, type AvatarState } from "@/lib/avatar-state";

interface BubbleProps {
  onOpen: () => void;
  isRunning: boolean;
  avatarState?: AvatarState;
}

const STORAGE_KEY = "claude-bubble-pos";

export function ClaudeBubble({ onOpen, isRunning, avatarState }: BubbleProps) {
  const [pos, setPos] = useState({ right: 32, bottom: 32 });
  const dragging = useRef(false);
  const startRef = useRef({ x: 0, y: 0, right: 32, bottom: 32 });
  const moved = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Load saved position
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        setPos(p);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    moved.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;

      const newRight = Math.max(8, Math.min(window.innerWidth - 72, startRef.current.right - dx));
      const newBottom = Math.max(8, Math.min(window.innerHeight - 72, startRef.current.bottom - dy));
      setPos({ right: newRight, bottom: newBottom });
    };

    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pos]);

  const handleClick = () => {
    if (!moved.current) {
      onOpen();
    }
  };

  return (
    <button
      ref={btnRef}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      style={{ right: pos.right, bottom: pos.bottom }}
      className="fixed z-50 flex h-14 w-14 items-center justify-center rounded-full bg-bot-elevated border border-bot-border shadow-xl hover:scale-105 active:scale-95 transition-transform select-none cursor-grab active:cursor-grabbing"
      title="Open Claude Code"
    >
      <div className="relative">
        <Image
          unoptimized
          src={getAvatarPath(avatarState ?? (isRunning ? "working" : "waiting"))}
          alt="Claude"
          width={36}
          height={36}
          className="rounded-full object-cover"
        />
        {/* Pulse indicator: green dot when running */}
        <span
          className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-bot-bg transition-colors ${
            isRunning ? "bg-bot-green animate-pulse" : "bg-bot-muted"
          }`}
        />
      </div>
    </button>
  );
}

export function useIsRunning(): boolean {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    const onOutput = ({ parsed }: { parsed: { type: string } }) => {
      if (parsed.type !== "done") setRunning(true);
    };

    const onDone = () => setRunning(false);

    socket.on("claude:output", onOutput);
    socket.on("claude:command_done", onDone);

    return () => {
      socket.off("claude:output", onOutput);
      socket.off("claude:command_done", onDone);
    };
  }, []);

  return running;
}
