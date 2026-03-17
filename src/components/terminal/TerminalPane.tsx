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

    // Stable refs for callbacks — updated on each render but never cause re-init
    const onOutputRef = useRef(onOutput);
    const onActivityRef = useRef(onActivity);
    const onCwdRef = useRef(onCwd);
    const onCloseRef = useRef(onClose);
    useEffect(() => { onOutputRef.current = onOutput; }, [onOutput]);
    useEffect(() => { onActivityRef.current = onActivity; }, [onActivity]);
    useEffect(() => { onCwdRef.current = onCwd; }, [onCwd]);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

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

      const container = containerRef.current;
      if (!container) return;

      // Wait until the container is visible before initializing xterm.
      // xterm opened in a 0-width container gets stuck at cols=1.
      await new Promise<void>((resolve) => {
        if (container.offsetWidth > 10) { resolve(); return; }
        let attempts = 0;
        const check = setInterval(() => {
          attempts++;
          if ((containerRef.current?.offsetWidth ?? 0) > 10 || attempts > 40) {
            clearInterval(check);
            resolve();
          }
        }, 150);
      });

      if (!containerRef.current || termRef.current) return; // Re-check after await

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
      termRef.current = term;

      // Track line count for bookmarks
      term.onLineFeed(() => {
        lineCountRef.current++;
      });

      const socket = getSocket();

      const doAttach = () => {
        const el = containerRef.current;
        if (!el) return;
        try {
          fitAddon.fit();
          if (term.cols < 10) {
            const computedCols = Math.max(1, Math.floor(el.offsetWidth / 7));
            const computedRows = Math.max(1, Math.floor(el.offsetHeight / 17));
            term.resize(computedCols, computedRows);
            fitAddon.fit();
          }
        } catch { /* ignore */ }
        const { cols, rows } = term;
        socket.emit("terminal:attach", { tabId, cols: Math.max(cols, 80), rows: Math.max(rows, 24) });
      };

      // Use a polling approach to wait for container to have real dimensions.
      let fitAttempts = 0;
      let attachSent = false;
      const MAX_FIT_ATTEMPTS = 20;
      const tryFit = () => {
        if (attachSent) return;
        fitAttempts++;
        const el = containerRef.current;
        if (el && el.offsetWidth > 10 && el.offsetHeight > 10) {
          attachSent = true;
          doAttach();
        } else if (fitAttempts < MAX_FIT_ATTEMPTS) {
          setTimeout(tryFit, 150);
        } else {
          attachSent = true;
          socket.emit("terminal:attach", { tabId, cols: 80, rows: 24 });
        }
      };
      setTimeout(tryFit, 100);

      const handleOutput = ({ tabId: tid, data }: { tabId: string; data: string }) => {
        if (tid !== tabId) return;
        term.write(data);
        onOutputRef.current?.(data);
        onActivityRef.current?.();
      };

      const handleAttached = ({ tabId: tid }: { tabId: string }) => {
        if (tid !== tabId) return;
        // Force a resize to ensure PTY dimensions match the rendered terminal
        try {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit();
          }
          const { cols, rows } = term;
          if (cols > 1) {
            socket.emit("terminal:resize", { tabId, cols, rows });
          }
        } catch { /* ignore */ }
      };

      const handleClosed = ({ tabId: tid }: { tabId: string }) => {
        if (tid !== tabId) return;
        term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
        onCloseRef.current?.();
      };

      const handleCwd = ({ tabId: tid, cwd }: { tabId: string; cwd: string }) => {
        if (tid !== tabId) return;
        onCwdRef.current?.(cwd);
      };

      // Re-attach when socket reconnects so the new socket.id joins tabSocketMap
      const handleReconnect = () => {
        doAttach();
      };

      socket.on("terminal:output", handleOutput);
      socket.on("terminal:attached", handleAttached);
      socket.on("terminal:closed", handleClosed);
      socket.on("terminal:cwd", handleCwd);
      socket.on("connect", handleReconnect);

      // Forward keyboard input
      term.onData((data) => {
        socket.emit("terminal:input", { tabId, data });

        if (!autoNameSentRef.current && data === "\r") {
          autoNameSentRef.current = true;
        }
      });

      // Resize observer — also fires when parent becomes visible
      const resizeObserver = new ResizeObserver(() => {
        const el = containerRef.current;
        if (el && el.offsetWidth > 10) {
          try {
            fitAddon.fit();
            const { cols, rows } = term;
            socket.emit("terminal:resize", { tabId, cols, rows });
          } catch { /* ignore */ }
        }
      });
      if (containerRef.current) resizeObserver.observe(containerRef.current);

      return () => {
        socket.off("terminal:output", handleOutput);
        socket.off("terminal:attached", handleAttached);
        socket.off("terminal:closed", handleClosed);
        socket.off("terminal:cwd", handleCwd);
        socket.off("connect", handleReconnect);
        socket.emit("terminal:detach", { tabId });
        resizeObserver.disconnect();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    // Only re-initialize when the tabId changes, not when callbacks change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabId]);

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
