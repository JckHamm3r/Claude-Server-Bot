import fs from "fs";
import path from "path";
import type { HandlerContext } from "./types";
import {
  saveMessage,
  getSession,
  getMessages,
  deleteMessage,
  deleteMessagesAfter,
  updateMessageContent,
  getMessage,
  getSessionTokenUsage,
  getGlobalTokenUsage,
  canAccessSession,
  canModifySession,
  getUpload,
} from "../lib/claude-db";
import { logActivity } from "../lib/activity-log";
import { getAppSetting } from "../lib/app-settings";
import { checkBotConfigRequest } from "../lib/security-guard";
import { dispatchNotification } from "../lib/notifications";

// Per-session AI chat pause state
const aiPausedSessions = new Map<string, { paused: boolean; pausedAt: string | null; pausedBy: string | null }>();

export function isAiPaused(sessionId: string): boolean {
  return aiPausedSessions.get(sessionId)?.paused ?? false;
}

export function getAiPauseState(sessionId: string): { paused: boolean; pausedAt: string | null; pausedBy: string | null } {
  return aiPausedSessions.get(sessionId) ?? { paused: false, pausedAt: null, pausedBy: null };
}

interface BudgetResult {
  exceeded: boolean;
  warning: boolean;
  type?: "session" | "daily" | "monthly";
  limit?: number;
  current?: number;
}

function checkBudget(email: string, sessionId: string): BudgetResult {
  const sessionBudget = parseFloat(getAppSetting("budget_limit_session_usd", "0"));
  if (sessionBudget > 0) {
    const usage = getSessionTokenUsage(sessionId);
    if (usage.total_cost_usd >= sessionBudget) {
      return { exceeded: true, warning: false, type: "session", limit: sessionBudget, current: usage.total_cost_usd };
    }
    if (usage.total_cost_usd >= sessionBudget * 0.8) {
      return { exceeded: false, warning: true, type: "session", limit: sessionBudget, current: usage.total_cost_usd };
    }
  }

  const dailyBudget = parseFloat(getAppSetting("budget_limit_daily_usd", "0"));
  if (dailyBudget > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const usage = getGlobalTokenUsage({ since: today.toISOString(), userId: email });
    if (usage.total_cost_usd >= dailyBudget) {
      return { exceeded: true, warning: false, type: "daily", limit: dailyBudget, current: usage.total_cost_usd };
    }
    if (usage.total_cost_usd >= dailyBudget * 0.8) {
      return { exceeded: false, warning: true, type: "daily", limit: dailyBudget, current: usage.total_cost_usd };
    }
  }

  const monthlyBudget = parseFloat(getAppSetting("budget_limit_monthly_usd", "0"));
  if (monthlyBudget > 0) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const usage = getGlobalTokenUsage({ since: monthStart.toISOString(), userId: email });
    if (usage.total_cost_usd >= monthlyBudget) {
      return { exceeded: true, warning: false, type: "monthly", limit: monthlyBudget, current: usage.total_cost_usd };
    }
    if (usage.total_cost_usd >= monthlyBudget * 0.8) {
      return { exceeded: false, warning: true, type: "monthly", limit: monthlyBudget, current: usage.total_cost_usd };
    }
  }

  return { exceeded: false, warning: false };
}

export function registerMessageHandlers(ctx: HandlerContext) {
  const { socket, io, email } = ctx;

  socket.on(
    "claude:message",
    async ({ sessionId, content, attachments }: { sessionId: string; content: string; attachments?: string[] }) => {
      try {
        if (typeof content !== "string" || (!content.trim() && (!attachments || attachments.length === 0))) {
          socket.emit("claude:error", { sessionId, message: "Message content is required" });
          return;
        }

        if (!canAccessSession(sessionId, email)) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }

        // Rate limiting
        const rl = ctx.checkRateLimit(email, sessionId);
        if (!rl.ok) {
          socket.emit("claude:rate_limited", {
            sessionId,
            reason: rl.reason,
            limits: {
              commands: getAppSetting("rate_limit_commands", "100"),
              runtime_min: getAppSetting("rate_limit_runtime_min", "30"),
              concurrent: getAppSetting("rate_limit_concurrent", "3"),
            },
          });
          dispatchNotification(
            "session_limit_reached",
            email,
            "Session limit reached",
            rl.reason ?? "A session limit was reached.",
          ).catch(() => {});
          return;
        }

        // Guard rails: check for bot-config modification attempts
        const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
        if (guardEnabled) {
          const suspicion = checkBotConfigRequest(content);
          if (suspicion.suspicious) {
            logActivity("security_mod_blocked", email, { reason: suspicion.reason, message: content.slice(0, 200) });
            io.to(`session:${sessionId}`).emit("claude:output", {
              sessionId,
              parsed: {
                type: "text",
                content: "I'm not able to modify bot configuration through chat. Please use the **Settings** panel to manage users, rate limits, SMTP, and other configuration. This is a security restriction to prevent unauthorized changes.",
              },
              submittedBy: email,
            });
            io.to(`session:${sessionId}`).emit("claude:command_done", { sessionId });
            io.to(`session:${sessionId}`).emit("security:warn", {
              type: "suspicious_input",
              message: "Message blocked: suspected bot configuration modification request.",
            });
            return;
          }
        }

        ctx.incrementSessionCommands(email, sessionId);

        // Budget check before sending
        const budget = checkBudget(email, sessionId);
        if (budget.exceeded) {
          socket.emit("claude:budget_exceeded", { sessionId, type: budget.type, limit: budget.limit, current: budget.current });
          return;
        }
        if (budget.warning) {
          socket.emit("claude:budget_warning", { sessionId, type: budget.type, limit: budget.limit, current: budget.current });
        }

        // Process attachments: separate images for --input-file, text for inline
        let fullContent = content;
        const inputFiles: string[] = [];
        if (attachments && attachments.length > 0) {
          try {
            const DATA_DIR = process.env.DATA_DIR ?? "./data";

            const contextParts: string[] = [];
            const imageMetadata: { id: string; name: string; mime_type: string }[] = [];
            for (const uploadId of attachments) {
              const upload = getUpload(uploadId);
              if (!upload) continue;
              const filePath = path.join(DATA_DIR, "uploads", upload.session_id, upload.stored_name);
              if (!fs.existsSync(filePath)) continue;

              if (upload.mime_type.startsWith("image/")) {
                // Use --input-file for images so Claude can actually see them
                inputFiles.push(filePath);
                imageMetadata.push({ id: upload.id, name: upload.original_name, mime_type: upload.mime_type });
              } else {
                try {
                  const MAX_ATTACHMENT_BYTES = 512_000; // 500 KB per file
                  let fileContent = fs.readFileSync(filePath, "utf-8") as string;
                  if (fileContent.length > MAX_ATTACHMENT_BYTES) {
                    fileContent = fileContent.slice(0, MAX_ATTACHMENT_BYTES) + "\n\n[truncated — file exceeded 500 KB limit]";
                  }
                  contextParts.push(`--- File: ${upload.original_name} ---\n${fileContent}\n--- End of ${upload.original_name} ---`);
                } catch {
                  contextParts.push(`[Attached file: ${upload.original_name}] (could not read contents)`);
                }
              }
            }

            if (contextParts.length > 0) {
              fullContent = contextParts.join("\n\n") + "\n\n" + content;
            }

            // Store image attachment metadata for rendering
            if (imageMetadata.length > 0) {
              const existingMeta = attachments?.length ? { attachments, imageAttachments: imageMetadata } : { imageAttachments: imageMetadata };
              saveMessage(sessionId, "admin", content, email, "chat", existingMeta);
            } else {
              const msgMetadata = attachments?.length ? { attachments } : undefined;
              saveMessage(sessionId, "admin", content, email, "chat", msgMetadata);
            }
          } catch (err) {
            console.error("[upload] Error processing attachments:", err);
            const msgMetadata = attachments?.length ? { attachments } : undefined;
            saveMessage(sessionId, "admin", content, email, "chat", msgMetadata);
          }
        } else {
          saveMessage(sessionId, "admin", content, email, "chat");
        }

        // When AI is paused, save the message but don't forward to Claude.
        // Broadcast it to other participants so everyone sees it in real time.
        if (isAiPaused(sessionId)) {
          io.to(`session:${sessionId}`).emit("claude:chat_broadcast", {
            sessionId,
            message: {
              id: crypto.randomUUID(),
              sender_type: "admin",
              sender_id: email,
              content,
              timestamp: new Date().toISOString(),
            },
            fromSocketId: socket.id,
          });
          return;
        }

        ctx.sessionCommandSubmitter.set(sessionId, email);
        io.to(`session:${sessionId}`).emit("claude:command_started", { sessionId, submittedBy: email });
        const sessionProvider = ctx.getSessionProvider(sessionId);
        ctx.setSessionStatus(sessionId, "running");
        sessionProvider.sendMessage(sessionId, fullContent, { inputFiles: inputFiles.length > 0 ? inputFiles : undefined });
      } catch (err) {
        socket.emit("claude:error", { sessionId, message: String(err) });
      }
    },
  );

  socket.on("claude:interrupt", ({ sessionId }: { sessionId: string }) => {
    if (!canAccessSession(sessionId, email)) {
      socket.emit("claude:error", { sessionId, message: "Access denied" });
      return;
    }
    const sp = ctx.getSessionProvider(sessionId);
    sp.interrupt(sessionId);
    ctx.setSessionStatus(sessionId, "idle");
  });

  socket.on(
    "claude:select_option",
    ({ sessionId, choice }: { sessionId: string; choice: string }) => {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const sp = ctx.getSessionProvider(sessionId);
      sp.sendMessage(sessionId, choice);
    },
  );

  socket.on(
    "claude:confirm",
    ({ sessionId, value }: { sessionId: string; value: boolean }) => {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const sp = ctx.getSessionProvider(sessionId);
      sp.sendMessage(sessionId, value ? "y" : "n");
    },
  );

  socket.on(
    "claude:answer_question",
    ({ sessionId, answer }: { sessionId: string; answer: string }) => {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const sp = ctx.getSessionProvider(sessionId);
      sp.sendMessage(sessionId, answer);
    },
  );

  socket.on(
    "claude:allow_tool",
    ({ sessionId, toolName, scope, toolCallId }: { sessionId: string; toolName: string; scope?: "session" | "once"; toolCallId?: string }) => {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const sp = ctx.getSessionProvider(sessionId);
      ctx.setSessionStatus(sessionId, "running");
      sp.allowTool(sessionId, toolName, scope ?? "once", toolCallId);
    },
  );

  // ── Message edit & delete ────────────────────────────────────────────

  socket.on(
    "claude:edit_message",
    async ({ sessionId, messageId, newContent }: { sessionId: string; messageId: string; newContent: string }) => {
      try {
        if (!canModifySession(sessionId, email)) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }

        const rl = ctx.checkRateLimit(email, sessionId);
        if (!rl.ok) {
          socket.emit("claude:rate_limited", {
            sessionId,
            reason: rl.reason,
            limits: {
              commands: getAppSetting("rate_limit_commands", "100"),
              runtime_min: getAppSetting("rate_limit_runtime_min", "30"),
              concurrent: getAppSetting("rate_limit_concurrent", "3"),
            },
          });
          return;
        }

        const budget = checkBudget(email, sessionId);
        if (budget.exceeded) {
          socket.emit("claude:budget_exceeded", { sessionId, type: budget.type, limit: budget.limit, current: budget.current });
          return;
        }

        const session = getSession(sessionId);
        if (!session) return;

        const msg = getMessage(messageId);
        if (!msg || msg.session_id !== sessionId) return;

        deleteMessagesAfter(sessionId, msg.timestamp);
        updateMessageContent(messageId, newContent);

        const messages = getMessages(sessionId);
        io.to(`session:${sessionId}`).emit("claude:messages_updated", { sessionId, messages });

        const sessionProvider = ctx.getSessionProvider(sessionId, session.provider_type);
        ctx.ensureSessionListener(sessionId);

        const editPrefix = "[The user edited their previous message. Disregard the earlier version and respond to this updated request instead.]\n\n";

        ctx.incrementSessionCommands(email, sessionId);
        ctx.sessionCommandSubmitter.set(sessionId, email);
        io.to(`session:${sessionId}`).emit("claude:command_started", { sessionId, submittedBy: email });
        sessionProvider.sendMessage(sessionId, editPrefix + newContent);
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:delete_message",
    ({ sessionId, messageId }: { sessionId: string; messageId: string }) => {
      try {
        if (!canModifySession(sessionId, email)) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }
        deleteMessage(messageId);
        io.to(`session:${sessionId}`).emit("claude:message_deleted", { sessionId, messageId });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  // ── AI chat toggle (pause/resume) ──────────────────────────────────

  socket.on(
    "claude:toggle_chat",
    ({ sessionId }: { sessionId: string }) => {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }

      const current = aiPausedSessions.get(sessionId);
      const wasPaused = current?.paused ?? false;
      const nowPaused = !wasPaused;

      if (nowPaused) {
        aiPausedSessions.set(sessionId, {
          paused: true,
          pausedAt: new Date().toISOString(),
          pausedBy: email,
        });
      } else {
        const pausedAt = current?.pausedAt ?? null;
        aiPausedSessions.set(sessionId, { paused: false, pausedAt: null, pausedBy: null });

        // On resume: collect messages sent during the pause and feed them
        // to Claude as context so it knows what was discussed.
        if (pausedAt) {
          const allMessages = getMessages(sessionId);
          const pausedMessages = allMessages.filter(
            (m) => m.sender_type === "admin" && m.timestamp > pausedAt,
          );

          if (pausedMessages.length > 0) {
            const recap = pausedMessages
              .map((m) => `[${m.sender_id ?? "user"}]: ${m.content}`)
              .join("\n");
            const contextMessage =
              `[System: While you were paused, the following conversation happened between users. ` +
              `Please acknowledge it briefly and continue assisting.]\n\n${recap}`;

            ctx.sessionCommandSubmitter.set(sessionId, email);
            io.to(`session:${sessionId}`).emit("claude:command_started", { sessionId, submittedBy: email });
            const sessionProvider = ctx.getSessionProvider(sessionId);
            ctx.setSessionStatus(sessionId, "running");
            ctx.ensureSessionListener(sessionId);
            sessionProvider.sendMessage(sessionId, contextMessage);
          }
        }
      }

      io.to(`session:${sessionId}`).emit("claude:chat_toggled", {
        sessionId,
        paused: nowPaused,
        pausedBy: nowPaused ? email : null,
      });
    },
  );

  socket.on(
    "claude:get_chat_state",
    ({ sessionId }: { sessionId: string }) => {
      if (!canAccessSession(sessionId, email)) return;
      const state = getAiPauseState(sessionId);
      socket.emit("claude:chat_toggled", {
        sessionId,
        paused: state.paused,
        pausedBy: state.pausedBy,
      });
    },
  );
}
