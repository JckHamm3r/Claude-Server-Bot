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
} from "../lib/claude-db";
import { logActivity } from "../lib/activity-log";
import { getAppSetting } from "../lib/app-settings";
import { checkBotConfigRequest } from "../lib/security-guard";
import { dispatchNotification } from "../lib/notifications";

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
        const sessionBudget = parseFloat(getAppSetting("budget_limit_session_usd", "0"));
        const dailyBudget = parseFloat(getAppSetting("budget_limit_daily_usd", "0"));
        const monthlyBudget = parseFloat(getAppSetting("budget_limit_monthly_usd", "0"));

        if (sessionBudget > 0) {
          const sessionUsage = getSessionTokenUsage(sessionId);
          if (sessionUsage.total_cost_usd >= sessionBudget) {
            socket.emit("claude:budget_exceeded", { sessionId, type: "session", limit: sessionBudget, current: sessionUsage.total_cost_usd });
            return;
          }
          if (sessionUsage.total_cost_usd >= sessionBudget * 0.8) {
            socket.emit("claude:budget_warning", { sessionId, type: "session", limit: sessionBudget, current: sessionUsage.total_cost_usd });
          }
        }

        if (dailyBudget > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const dailyUsage = getGlobalTokenUsage({ since: today.toISOString(), userId: email });
          if (dailyUsage.total_cost_usd >= dailyBudget) {
            socket.emit("claude:budget_exceeded", { sessionId, type: "daily", limit: dailyBudget, current: dailyUsage.total_cost_usd });
            return;
          }
        }

        if (monthlyBudget > 0) {
          const monthStart = new Date();
          monthStart.setDate(1);
          monthStart.setHours(0, 0, 0, 0);
          const monthlyUsage = getGlobalTokenUsage({ since: monthStart.toISOString(), userId: email });
          if (monthlyUsage.total_cost_usd >= monthlyBudget) {
            socket.emit("claude:budget_exceeded", { sessionId, type: "monthly", limit: monthlyBudget, current: monthlyUsage.total_cost_usd });
            return;
          }
        }

        // Process attachments: separate images for --input-file, text for inline
        let fullContent = content;
        const inputFiles: string[] = [];
        if (attachments && attachments.length > 0) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getUpload } = require("../lib/claude-db") as typeof import("../lib/claude-db");
            const fs = require("fs");
            const pathMod = require("path");
            const DATA_DIR = process.env.DATA_DIR ?? "./data";

            const contextParts: string[] = [];
            const imageMetadata: { id: string; name: string; mime_type: string }[] = [];
            for (const uploadId of attachments) {
              const upload = getUpload(uploadId);
              if (!upload) continue;
              const filePath = pathMod.join(DATA_DIR, "uploads", upload.session_id, upload.stored_name);
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
    ({ sessionId, toolName, scope }: { sessionId: string; toolName: string; scope?: "session" | "once" }) => {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const sp = ctx.getSessionProvider(sessionId);
      ctx.setSessionStatus(sessionId, "running");
      sp.allowTool(sessionId, toolName, scope ?? "once");
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

        const sessionBudget = parseFloat(getAppSetting("budget_limit_session_usd", "0"));
        if (sessionBudget > 0) {
          const sessionUsage = getSessionTokenUsage(sessionId);
          if (sessionUsage.total_cost_usd >= sessionBudget) {
            socket.emit("claude:budget_exceeded", { sessionId, type: "session", limit: sessionBudget, current: sessionUsage.total_cost_usd });
            return;
          }
        }

        const dailyBudget = parseFloat(getAppSetting("budget_limit_daily_usd", "0"));
        if (dailyBudget > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const dailyUsage = getGlobalTokenUsage({ since: today.toISOString(), userId: email });
          if (dailyUsage.total_cost_usd >= dailyBudget) {
            socket.emit("claude:budget_exceeded", { sessionId, type: "daily", limit: dailyBudget, current: dailyUsage.total_cost_usd });
            return;
          }
        }

        const monthlyBudget = parseFloat(getAppSetting("budget_limit_monthly_usd", "0"));
        if (monthlyBudget > 0) {
          const monthStart = new Date();
          monthStart.setDate(1);
          monthStart.setHours(0, 0, 0, 0);
          const monthlyUsage = getGlobalTokenUsage({ since: monthStart.toISOString(), userId: email });
          if (monthlyUsage.total_cost_usd >= monthlyBudget) {
            socket.emit("claude:budget_exceeded", { sessionId, type: "monthly", limit: monthlyBudget, current: monthlyUsage.total_cost_usd });
            return;
          }
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
}
