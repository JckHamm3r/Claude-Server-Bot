import type { HandlerContext } from "./types";
import {
  createSession,
  getSession,
  getMessages,
  listSessions,
  renameSession,
  deleteSession,
  updateSessionTags,
  updateSessionModel,
  getSessionTokenUsage,
  getGlobalTokenUsage,
  getUserSettings,
  updateUserSettings,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  canAccessSession,
  canModifySession,
  addSessionParticipant,
  removeSessionParticipant,
  listSessionParticipants,
} from "../lib/claude-db";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "../lib/models";
import { isSDKAvailable } from "../lib/claude";
import { logActivity } from "../lib/activity-log";
import { getAppSetting, getPersonalityPrefix } from "../lib/app-settings";
import { getCustomizationSystemPrompt } from "../lib/customization";
import { getSecuritySystemPrompt } from "../lib/security-guard";
import { dispatchNotification } from "../lib/notifications";
import db from "../lib/db";

export function registerSessionHandlers(ctx: HandlerContext) {
  const { socket, io, email, isAdmin } = ctx;

  socket.on(
    "claude:create_session",
    async ({
      sessionId,
      skipPermissions,
      interface_type,
      model,
      provider_type,
      templateId,
    }: {
      sessionId: string;
      skipPermissions?: boolean;
      interface_type?: "ui_chat" | "customization_interface" | "system_agent";
      model?: string;
      provider_type?: string;
      templateId?: string;
    }) => {
      try {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) {
          socket.emit("claude:error", { sessionId, message: "Invalid session ID format" });
          return;
        }

        // Apply template if provided
        let templateSystemPrompt: string | undefined;
        if (templateId) {
          const template = getTemplate(templateId);
          if (template) {
            model = model ?? template.model;
            skipPermissions = skipPermissions ?? template.skip_permissions;
            provider_type = provider_type ?? template.provider_type;
            templateSystemPrompt = template.system_prompt ?? undefined;
          }
        }

        const sessionModel = model ?? DEFAULT_MODEL;
        const sessionProviderType = provider_type ?? "subprocess";
        createSession(sessionId, email, skipPermissions ?? false, sessionModel, sessionProviderType);

        // Resolve per-session provider
        const sessionProvider = ctx.getSessionProvider(sessionId, sessionProviderType);

        // Build system prompt based on interface_type
        let systemPrompt: string | undefined;
        if (interface_type === "customization_interface") {
          systemPrompt = await getCustomizationSystemPrompt();
          logActivity("customization_session_started", email, { sessionId });
        } else if (interface_type === "system_agent") {
          systemPrompt = undefined; // bare, no personality
        } else {
          // Default: ui_chat — personality prefix only
          const personalityPrefix = getPersonalityPrefix();
          systemPrompt = personalityPrefix || undefined;
        }

        // Prepend template system prompt if set
        if (templateSystemPrompt) {
          systemPrompt = systemPrompt ? templateSystemPrompt + "\n\n" + systemPrompt : templateSystemPrompt;
        }

        // Prepend security system prompt if guard rails are enabled
        const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
        const securityPrefix = getSecuritySystemPrompt(guardEnabled);
        if (securityPrefix) {
          systemPrompt = systemPrompt ? securityPrefix + "\n\n" + systemPrompt : securityPrefix;
        }

        sessionProvider.createSession(sessionId, {
          skipPermissions,
          model: sessionModel,
          ...(systemPrompt ? { systemPrompt } : {}),
        });

        socket.join(`session:${sessionId}`);

        ctx.connectedUsers.set(socket.id, { email, activeSession: sessionId });
        ctx.broadcastPresence();

        ctx.sessionStartTimes.set(sessionId, Date.now());
        ctx.metricsBuffer.session_count++;

        ctx.ensureSessionListener(sessionId);

        const currentContent = ctx.sessionStreamingContent.get(sessionId);
        if (currentContent && sessionProvider.isRunning(sessionId)) {
          socket.emit("claude:output", {
            sessionId,
            parsed: { type: "streaming", content: currentContent },
            submittedBy: ctx.sessionCommandSubmitter.get(sessionId),
          });
        }

        const currentlyRunning = sessionProvider.isRunning(sessionId);
        socket.emit("claude:session_ready", { sessionId, running: currentlyRunning, status: currentlyRunning ? "running" : "idle" });
      } catch (err) {
        socket.emit("claude:error", { sessionId, message: String(err) });
      }
    },
  );

  socket.on(
    "claude:set_active_session",
    ({ sessionId }: { sessionId: string | null }) => {
      if (sessionId && !canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      ctx.connectedUsers.set(socket.id, { email, activeSession: sessionId });
      if (sessionId) socket.join(`session:${sessionId}`);
      ctx.broadcastPresence();
    },
  );

  socket.on("claude:list_sessions", () => {
    try {
      const sessions = listSessions(email);
      socket.emit("claude:sessions", { sessions });
    } catch {
      socket.emit("claude:sessions", { sessions: [] });
    }
  });

  socket.on("claude:get_messages", ({ sessionId }: { sessionId: string }) => {
    try {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const messages = getMessages(sessionId);
      socket.emit("claude:messages", { sessionId, messages });
    } catch {
      socket.emit("claude:error", { sessionId, message: "Failed to load messages" });
    }
  });

  socket.on(
    "claude:rename_session",
    ({ sessionId, name }: { sessionId: string; name: string }) => {
      try {
        if (!canModifySession(sessionId, email)) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }
        renameSession(sessionId, name);
      } catch (err: unknown) {
        console.error("[db] rename_session failed:", err);
        socket.emit("claude:error", { message: "Failed to rename session." });
      }
      try {
        const sessions = listSessions(email);
        socket.emit("claude:sessions", { sessions });
      } catch {
        socket.emit("claude:sessions", { sessions: [] });
      }
    },
  );

  socket.on("claude:delete_session", ({ sessionId }: { sessionId: string }) => {
    try {
      if (!canModifySession(sessionId, email)) return;
      const sp = ctx.getSessionProvider(sessionId);
      sp.offOutput(sessionId);
      sp.closeSession(sessionId);
      ctx.sessionStreamingContent.delete(sessionId);
      ctx.sessionPendingUsage.delete(sessionId);
      ctx.sessionCommandSubmitter.delete(sessionId);
      ctx.sessionListeners.delete(sessionId);
      ctx.sessionStartTimes.delete(sessionId);
      ctx.sessionProviders.delete(sessionId);

      // Clean up upload files from disk
      try {
        const DATA_DIR = process.env.DATA_DIR ?? "./data";
        const uploadDir = require("path").join(DATA_DIR, "uploads", sessionId);
        const fs = require("fs");
        if (fs.existsSync(uploadDir)) {
          fs.rmSync(uploadDir, { recursive: true, force: true });
        }
      } catch { /* ignore cleanup errors */ }

      deleteSession(sessionId);
    } catch (err: unknown) {
      console.error("[db] Failed to delete session:", err);
    }
    try {
      const sessions = listSessions(email);
      socket.emit("claude:sessions", { sessions });
    } catch {
      socket.emit("claude:sessions", { sessions: [] });
    }
  });

  socket.on(
    "claude:update_session_tags",
    ({ sessionId, tags }: { sessionId: string; tags: string[] }) => {
      try {
        const session = getSession(sessionId);
        if (!session || session.created_by !== email) return;
        updateSessionTags(sessionId, tags);
      } catch (err: unknown) {
        console.error("[db] update_session_tags failed:", err);
        socket.emit("claude:error", { message: "Failed to update session tags." });
      }
      try {
        const sessions = listSessions(email);
        socket.emit("claude:sessions", { sessions });
      } catch {
        socket.emit("claude:sessions", { sessions: [] });
      }
    },
  );

  socket.on("claude:close_session", ({ sessionId }: { sessionId: string }) => {
    if (!canModifySession(sessionId, email)) {
      socket.emit("claude:error", { sessionId, message: "Access denied" });
      return;
    }
    const sp = ctx.getSessionProvider(sessionId);
    sp.offOutput(sessionId);
    sp.closeSession(sessionId);
    ctx.setSessionStatus(sessionId, "idle");
    ctx.sessionListeners.delete(sessionId);
    ctx.sessionStartTimes.delete(sessionId);
    ctx.sessionProviders.delete(sessionId);
    ctx.sessionStreamingContent.delete(sessionId);
    ctx.sessionPendingUsage.delete(sessionId);
    ctx.sessionCommandSubmitter.delete(sessionId);
  });

  // ── Model switching ────────────────────────────────────────────────────

  socket.on(
    "claude:set_model",
    ({ sessionId, model }: { sessionId: string; model: string }) => {
      try {
        if (!canModifySession(sessionId, email)) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }
        if (!AVAILABLE_MODELS.some((m) => m.value === model)) {
          socket.emit("claude:error", { sessionId, message: "Invalid model" });
          return;
        }
        updateSessionModel(sessionId, model);
        io.to(`session:${sessionId}`).emit("claude:model_changed", { sessionId, model });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  // ── Session state sync (reconnection) ─────────────────────────────
  socket.on(
    "claude:get_session_state",
    ({ sessionId }: { sessionId: string }) => {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const sp = ctx.getSessionProvider(sessionId);
      socket.emit("claude:session_state", {
        sessionId,
        running: sp.isRunning(sessionId),
      });
    },
  );

  // ── Token usage ──────────────────────────────────────────────────────

  socket.on(
    "claude:get_usage",
    ({ sessionId }: { sessionId: string }) => {
      try {
        if (!canAccessSession(sessionId, email)) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }
        const usage = getSessionTokenUsage(sessionId);
        socket.emit("claude:session_usage", { sessionId, usage });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:get_global_usage", ({ since, userId }: { since?: string; userId?: string }) => {
    try {
      const effectiveUserId = isAdmin ? userId : email;
      const usage = getGlobalTokenUsage({ since, userId: effectiveUserId });
      socket.emit("claude:global_usage", { usage });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Capabilities ─────────────────────────────────────────────────────

  socket.on("claude:get_capabilities", () => {
    socket.emit("claude:capabilities", {
      sdkAvailable: isSDKAvailable(),
      models: AVAILABLE_MODELS,
    });
  });

  // ── Kill all ──────────────────────────────────────────────────────────

  socket.on("claude:kill_all", async () => {
    if (!isAdmin) {
      socket.emit("claude:error", { message: "Admin access required" });
      return;
    }
    try {
      const allSessionIds = Array.from(ctx.sessionStreamingContent.keys());
      for (const sid of allSessionIds) {
        try { ctx.provider.interrupt(sid); } catch { /* ignore */ }
        ctx.sessionStreamingContent.delete(sid);
        ctx.sessionListeners.delete(sid);
      }
      logActivity("kill_all", email);
      socket.emit("claude:kill_all_done", { killed: allSessionIds.length });
      io.emit("claude:sessions_aborted");

      // Notify all admins
      const admins = db.prepare("SELECT email FROM users WHERE is_admin = 1").all() as { email: string }[];
      for (const admin of admins) {
        dispatchNotification("kill_all_triggered", admin.email, "Kill-all triggered", `All active sessions were terminated by ${email}.`).catch(() => {});
      }
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Settings handlers ─────────────────────────────────────────────────

  socket.on("claude:get_settings", () => {
    try {
      const s = getUserSettings(email);
      socket.emit("claude:settings", { settings: s });
    } catch { /* ignore */ }
  });

  socket.on(
    "claude:update_settings",
    (data: Partial<{ full_trust_mode: boolean; custom_default_context: string | null; auto_naming_enabled: boolean }>) => {
      try {
        const updated = updateUserSettings(email, data);
        socket.emit("claude:settings", { settings: updated });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  // ── Template handlers ──────────────────────────────────────────────────

  socket.on("claude:list_templates", () => {
    try {
      const templates = listTemplates();
      socket.emit("claude:templates", { templates });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on(
    "claude:create_template",
    (data: { name: string; description?: string; system_prompt?: string; model?: string; skip_permissions?: boolean; provider_type?: string; icon?: string; is_default?: boolean }) => {
      if (!isAdmin) {
        socket.emit("claude:error", { message: "Admin access required" });
        return;
      }
      try {
        createTemplate(data, email);
        const templates = listTemplates();
        socket.emit("claude:templates", { templates });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:update_template",
    ({ templateId, data }: { templateId: string; data: Partial<{ name: string; description: string; system_prompt: string; model: string; skip_permissions: boolean; provider_type: string; icon: string; is_default: boolean }> }) => {
      if (!isAdmin) {
        socket.emit("claude:error", { message: "Admin access required" });
        return;
      }
      try {
        updateTemplate(templateId, data);
        const templates = listTemplates();
        socket.emit("claude:templates", { templates });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:delete_template", ({ templateId }: { templateId: string }) => {
    if (!isAdmin) {
      socket.emit("claude:error", { message: "Admin access required" });
      return;
    }
    try {
      deleteTemplate(templateId);
      const templates = listTemplates();
      socket.emit("claude:templates", { templates });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Session sharing ────────────────────────────────────────────────────

  socket.on("claude:invite_to_session", ({ sessionId, inviteEmail }: { sessionId: string; inviteEmail: string }) => {
    try {
      if (!canModifySession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Only session owner or admin can invite" });
        return;
      }
      addSessionParticipant(sessionId, inviteEmail);
      socket.emit("claude:session_participants", { sessionId, participants: listSessionParticipants(sessionId) });
    } catch (err) {
      socket.emit("claude:error", { sessionId, message: "Failed to invite user" });
    }
  });

  socket.on("claude:remove_from_session", ({ sessionId, removeEmail }: { sessionId: string; removeEmail: string }) => {
    try {
      if (!canModifySession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Only session owner or admin can remove" });
        return;
      }
      removeSessionParticipant(sessionId, removeEmail);
      socket.emit("claude:session_participants", { sessionId, participants: listSessionParticipants(sessionId) });
    } catch (err) {
      socket.emit("claude:error", { sessionId, message: "Failed to remove user" });
    }
  });

  socket.on("claude:list_session_participants", ({ sessionId }: { sessionId: string }) => {
    try {
      if (!canAccessSession(sessionId, email)) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      socket.emit("claude:session_participants", { sessionId, participants: listSessionParticipants(sessionId) });
    } catch (err) {
      socket.emit("claude:error", { sessionId, message: "Failed to list participants" });
    }
  });
}
