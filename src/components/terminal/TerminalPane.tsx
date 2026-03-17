"use client";

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { getSocket } from "@/lib/socket";

export interface TerminalPaneHandle {
  focus: () => void;
  fit: () => void;
  getLineCount: () => number;
}

interface TerminalPaneProps {
  tabId: string;
  onOutput?: (data: string) => void;
  onActivity?: () => void;
  onCwd?: (cwd: string) => void;
  onClose?: () => void;
  className?: string;
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  ({ tabId, onOutput, onActivity, onCwd, onClose, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const termRef = useRef<any>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fitAddonRef = useRef<any>(null);
    const lineCountRef = useRef(0);
    const autoNameSentRef = useRef(false);

    useImperativeHandle(ref, () => ({
      focus: () => termRef.current?.focus(),
      fit: () => fitAddonRef.current?.fit(),
      getLineCount: () => lineCountRef.current,
    }));

    const initTerminal = useCallback(async () => {
      if (!containerRef.current || termRef.current) return;

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: "#0a0a10",
          foreground: "#c9d1d9",
          cursor: "#58a6ff",
          black: "#0d1117",
          red: "#ff7b72",
          green: "#3fb950",
          yellow: "#d29922",
          blue: "#58a6ff",
          magenta: "#bc8cff",
          cyan: "#39c5cf",
          white: "#b1bac4",
          brightBlack: "#6e7681",
          brightRed: "#ffa198",
          brightGreen: "#56d364",
          brightYellow: "#e3b341",
          brightBlue: "#79c0ff",
          brightMagenta: "#d2a8ff",
          brightCyan: "#56d4dd",
          brightWhite: "#f0f6fc",
        },
        scrollback: 2000,
        allowTransparency: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      fitAddonRef.current = fitAddon;

      term.open(containerRef.current);

      // Delay fit() until after the browser has painted and the container has real dimensions
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { fitAddon.fit(); } catch { /* ignore */ }
          // Attach to backend after fit so the server gets correct terminal dimensions
          const { cols, rows } = term;
          socket.emit("terminal:attach", { tabId, cols, rows });
        });
      });
      termRef.current = term;

      // Track line count for bookmarks
      term.onLineFeed(() => {
        lineCountRef.current++;
      });

      const socket = getSocket();

      const handleOutput = ({ tabId: tid, data }: { tabId: string; data: string }) => {
        if (tid !== tabId) return;
        term.write(data);
        onOutput?.(data);
        onActivity?.();
      };

      const handleScrollback = ({ tabId: tid, lines }: { tabId: string; lines: string[] }) => {
        if (tid !== tabId) return;
        if (lines.length > 0) {
          // Write scrollback as a replay header
          term.write("\r\n\x1b[90m── scrollback replay ──\x1b[0m\r\n");
          term.write(lines.join("\r\n"));
          term.write("\r\n\x1b[90m── live ──\x1b[0m\r\n");
        }
      };

      const handleAttached = ({ tabId: tid }: { tabId: string }) => {
        if (tid !== tabId) return;
        term.write("\x1b[90m[attached]\x1b[0m\r\n");
      };

      const handleClosed = ({ tabId: tid }: { tabId: string }) => {
        if (tid !== tabId) return;
        term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
        onClose?.();
      };

      const handleCwd = ({ tabId: tid, cwd }: { tabId: string; cwd: string }) => {
        if (tid !== tabId) return;
        onCwd?.(cwd);
      };

      socket.on("terminal:output", handleOutput);
      socket.on("terminal:scrollback", handleScrollback);
      socket.on("terminal:attached", handleAttached);
      socket.on("terminal:closed", handleClosed);
      socket.on("terminal:cwd", handleCwd);

      // Forward keyboard input
      term.onData((data) => {
        socket.emit("terminal:input", { tabId, data });

        // Auto-name: capture the first typed command (first Enter press)
        if (!autoNameSentRef.current && data === "\r") {
          autoNameSentRef.current = true;
          // Read current input from terminal buffer isn't trivial; we just send a signal
          // The backend will handle auto-naming if name is still default
          // We'll let the frontend supply name from terminal title or CWD
        }
      });

      // Resize observer
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        const { cols, rows } = term;
        socket.emit("terminal:resize", { tabId, cols, rows });
      });
      if (containerRef.current) resizeObserver.observe(containerRef.current);

      return () => {
        socket.off("terminal:output", handleOutput);
        socket.off("terminal:scrollback", handleScrollback);
        socket.off("terminal:attached", handleAttached);
        socket.off("terminal:closed", handleClosed);
        socket.off("terminal:cwd", handleCwd);
        socket.emit("terminal:detach", { tabId });
        resizeObserver.disconnect();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    }, [tabId, onOutput, onActivity, onCwd, onClose]);

    useEffect(() => {
      let cleanup: (() => void) | undefined;
      initTerminal().then((fn) => { cleanup = fn; });
      return () => { cleanup?.(); };
    }, [initTerminal]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ background: "#0a0a10", width: "100%", height: "100%" }}
      />
    );
  }
);

TerminalPane.displayName = "TerminalPane";
