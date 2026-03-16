"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket, connectSocket } from "@/lib/socket";
import { Terminal as TerminalIcon, X, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalTabProps {
  isAdmin: boolean;
}

export function TerminalTab({ isAdmin }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const startedRef = useRef(false);

  const startTerminal = useCallback(async () => {
    if (!isAdmin || !containerRef.current) return;
    setError(null);
    startedRef.current = true;

    try {
      // Dynamic import to avoid SSR issues with xterm
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      // Destroy existing terminal if any
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }

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

      if (containerRef.current) {
        term.open(containerRef.current);
        fitAddon.fit();
      }

      termRef.current = term;

      // Set up socket
      const socket = getSocket();
      connectSocket();

      const handleConnect = () => {
        setConnected(true);
        const { cols, rows } = term;
        socket.emit("terminal:start", { cols, rows });
      };

      const handleOutput = ({ data }: { data: string }) => {
        term.write(data);
      };

      const handleClose = () => {
        setRunning(false);
        term.write("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
      };

      const handleError = ({ message }: { message: string }) => {
        setError(message);
        setRunning(false);
        term.write(`\r\n\x1b[91m[Error: ${message}]\x1b[0m\r\n`);
      };

      socket.on("connect", handleConnect);
      socket.on("terminal:output", handleOutput);
      socket.on("terminal:close", handleClose);
      socket.on("claude:error", handleError);

      if (socket.connected) {
        handleConnect();
      }

      // Forward keyboard input to server
      term.onData((data) => {
        if (running || socket.connected) {
          socket.emit("terminal:input", { data });
        }
      });

      // Handle terminal resize
      const handleResize = () => {
        if (containerRef.current) {
          fitAddon.fit();
          const { cols, rows } = term;
          socket.emit("terminal:resize", { cols, rows });
        }
      };
      const resizeObserver = new ResizeObserver(handleResize);
      if (containerRef.current) resizeObserver.observe(containerRef.current);

      setRunning(true);

      return () => {
        socket.off("connect", handleConnect);
        socket.off("terminal:output", handleOutput);
        socket.off("terminal:close", handleClose);
        socket.off("claude:error", handleError);
        socket.emit("terminal:close");
        resizeObserver.disconnect();
        term.dispose();
        termRef.current = null;
        setRunning(false);
        setConnected(false);
      };
    } catch (err) {
      setError("Failed to initialize terminal: " + String(err));
    }
  }, [isAdmin, running]);

  // Start terminal on mount for admins
  useEffect(() => {
    if (!isAdmin) return;
    let cleanup: (() => void) | undefined;
    startTerminal().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRestart = useCallback(() => {
    // Kill existing session
    if (termRef.current) {
      getSocket().emit("terminal:close");
      termRef.current.dispose();
      termRef.current = null;
    }
    setRunning(false);
    setConnected(false);
    setError(null);
    startedRef.current = false;
    setTimeout(() => startTerminal(), 100);
  }, [startTerminal]);

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-4 text-bot-muted">
        <AlertTriangle className="h-12 w-12 text-bot-amber/50" />
        <p className="text-body font-medium text-bot-text">Admin access required</p>
        <p className="text-caption text-bot-muted">The terminal is only available to admin users.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a10] overflow-hidden">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-bot-surface/80 backdrop-blur-md border-b border-bot-border/30 shrink-0">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-4 w-4 text-bot-green" />
          <span className="text-body font-medium text-bot-text">Server Terminal</span>
          <span className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            connected && running
              ? "bg-bot-green/10 text-bot-green"
              : "bg-bot-muted/10 text-bot-muted"
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected && running ? "bg-bot-green animate-pulse" : "bg-bot-muted"
            )} />
            {connected && running ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRestart}
            className="flex items-center gap-1.5 rounded-lg border border-bot-border/40 px-3 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all duration-200"
            title="Restart terminal session"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Restart
          </button>
          <button
            onClick={() => getSocket().emit("terminal:close")}
            className="flex items-center gap-1.5 rounded-lg border border-bot-border/40 px-3 py-1.5 text-caption text-bot-muted hover:text-bot-red hover:bg-bot-red/10 hover:border-bot-red/30 transition-all duration-200"
            title="Close terminal session"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bot-red/10 border-b border-bot-red/30 text-bot-red text-caption shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <button
            onClick={handleRestart}
            className="ml-auto underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* xterm.js container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden p-1"
        style={{ background: "#0a0a10" }}
      />
    </div>
  );
}
