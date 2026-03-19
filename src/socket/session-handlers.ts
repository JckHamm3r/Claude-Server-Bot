import path from "path";
import fs from "fs";
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
  getUserGroupPermissions,
  getUserGroup,
} from "../lib/claude-db";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "../lib/models";
import { isSDKAvailable } from "../lib/claude";
import { logActivity } from "../lib/activity-log";
import { getAppSetting } from "../lib/app-settings";
import { dispatchNotification } from "../lib/notifications";
import { buildSystemPrompt } from "../lib/system-prompt";
import { dbAll } from "../lib/db";
import { releaseAllSessionLocks, cancelAllSessionQueuedOps } from "../lib/file-lock-manager";
import { transformerEvents } from "../lib/transformer-events";
import { clearAiPauseState } from "./message-handlers";

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
      personality,
      personality_custom,
    }: {
      sessionId: string;
      skipPermissions?: boolean;
      interface_type?: "ui_chat" | "customization_interface" | "system_agent";
      model?: string;
      provider_type?: string;
      templateId?: string;
      personality?: string;
      personality_custom?: string;
    }) => {
      try {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) {
          socket.emit("claude:error", { sessionId, message: "Invalid session ID format" });
          return;
        }

        // Block observe-only users (e.g. Guest) from creating sessions
        if (!isAdmin) {
          const observeCheckPerms = await getUserGroupPermissions(email);
          if (observeCheckPerms.platform.observe_only) {
            socket.emit("claude:error", { sessionId, message: "Your account is in observe-only mode. Session creation is not permitted." });
            return;
          }
          if (!observeCheckPerms.platform.sessions_create) {
            socket.emit("claude:error", { sessionId, message: "Your account does not have permission to create sessions." });
            return;
          }
        }

        // Apply template if provided
        let templateSystemPrompt: string | undefined;
        if (templateId) {
          const template = await getTemplate(templateId);
          if (template) {
            model = model ?? template.model;
            skipPermissions = skipPermissions ?? template.skip_permissions;
            provider_type = provider_type ?? template.provider_type;
            templateSystemPrompt = template.system_prompt ?? undefined;
          }
        }

        const sessionModel = model ?? DEFAULT_MODEL;
        const sessionProviderType = provider_type ?? "sdk";
        const sessionPersonality = personality ?? "professional";
        await createSession(sessionId, email, skipPermissions ?? false, sessionModel, sessionProviderType, sessionPersonality);

        // Resolve per-session provider
        const sessionProvider = ctx.getSessionProvider(sessionId, sessionProviderType);

        const userSettings = await getUserSettings(email);
        const groupPerms = isAdmin ? null : await getUserGroupPermissions(email);
        const userGroup = isAdmin ? null : await getUserGroup(email);
        const systemPrompt = await buildSystemPrompt({
          interfaceType: interface_type,
          personality: sessionPersonality,
          personalityCustom: personality_custom,
          templateSystemPrompt,
          communicationStyle: groupPerms?.prompt?.communication_style || "expert",
          autoSummary: userSettings.auto_summary,
          sessionId,
          groupPermissions: groupPerms,
          groupName: userGroup?.name,
          groupPromptAppend: groupPerms?.prompt?.system_prompt_append || undefined,
        });
        if (interface_type === "customization_interface") {
          await logActivity("customization_session_started", email, { sessionId });
          await logActivity("transformer_session_started", email, { sessionId });
        }

        // Emit lifecycle event for hook transformers
        try {
          transformerEvents.emit("session:created", {
            sessionId,
            interfaceType: interface_type ?? "ui_chat",
            userId: email,
          });
        } catch { /* hook errors must not affect session creation */ }

        sessionProvider.createSession(sessionId, {
          skipPermissions,
          model: sessionModel,
          userEmail: email,
          ...(systemPrompt ? { systemPrompt } : {}),
        });

        ctx.roomManager.switchTo(sessionId, email);

        ctx.sessionStartTimes.set(sessionId, Date.now());
        ctx.metricsBuffer.session_count++;

        ctx.ensureSessionListener(sessionId);

        const currentlyRunning = sessionProvider.isRunning(sessionId);
        socket.emit("claude:session_ready", { sessionId, running: currentlyRunning, status: currentlyRunning ? "running" : "idle" });
      } catch (err) {
        socket.emit("claude:error", { sessionId, message: String(err) });
      }
    },
  );

  socket.on(
    "claude:set_active_session",
    async ({ sessionId }: { sessionId: string | null }) => {
      if (sessionId && !(await canAccessSession(sessionId, email))) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      if (sessionId) {
        ctx.roomManager.switchTo(sessionId, email);
      } else {
        ctx.roomManager.leave(email);
      }
    },
  );

  socket.on("claude:list_sessions", async () => {
    try {
      const sessions = await listSessions(email);
      socket.emit("claude:sessions", { sessions });
    } catch {
      socket.emit("claude:sessions", { sessions: [] });
    }
  });

  socket.on("claude:get_messages", async ({ sessionId }: { sessionId: string }) => {
    try {
      if (!(await canAccessSession(sessionId, email))) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const messages = await getMessages(sessionId);
      socket.emit("claude:messages", { sessionId, messages });

      const sp = ctx.getSessionProvider(sessionId);
      const running = sp.isRunning(sessionId);
      if (running) {
        const eventBuffer = ctx.sessionEventBuffers.get(sessionId);
        if (eventBuffer && eventBuffer.length > 0) {
          for (const evt of eventBuffer) {
            socket.emit("claude:output", evt);
          }
        } else {
          const currentContent = ctx.sessionStreamingContent.get(sessionId);
          if (currentContent) {
            socket.emit("claude:output", {
              sessionId,
              parsed: { type: "streaming", content: currentContent },
              submittedBy: ctx.sessionCommandSubmitter.get(sessionId),
            });
          }
        }
      }
      socket.emit("claude:session_state", { sessionId, running });
    } catch {
      socket.emit("claude:error", { sessionId, message: "Failed to load messages" });
    }
  });

  socket.on(
    "claude:rename_session",
    async ({ sessionId, name }: { sessionId: string; name: string }) => {
      try {
        if (!(await canModifySession(sessionId, email))) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }
        await renameSession(sessionId, name);
        // Broadcast rename to all collaborators in the session room
        io.to(`session:${sessionId}`).emit("claude:session_renamed", { sessionId, name });
        // Also push updated session list to all participants' sockets
        // (covers participants who have the session in sidebar but not actively open)
        const participants = await listSessionParticipants(sessionId);
        for (const p of participants) {
          for (const [socketId, info] of ctx.connectedUsers.entries()) {
            if (info.email === p.user_email) {
              const pSessions = await listSessions(p.user_email);
              io.to(socketId).emit("claude:sessions", { sessions: pSessions });
            }
          }
        }
      } catch (err: unknown) {
        console.error("[db] rename_session failed:", err);
        socket.emit("claude:error", { sessionId, message: "Failed to rename session." });
      }
      try {
        const sessions = await listSessions(email);
        socket.emit("claude:sessions", { sessions });
      } catch {
        socket.emit("claude:sessions", { sessions: [] });
      }
    },
  );

  socket.on("claude:delete_session", async ({ sessionId }: { sessionId: string }) => {
    try {
      if (!(await canModifySession(sessionId, email))) return;
      // Notify participants and evict all sockets from the room
      io.to(`session:${sessionId}`).emit("claude:session_deleted", { sessionId });
      io.in(`session:${sessionId}`).socketsLeave(`session:${sessionId}`);
      const sp = ctx.getSessionProvider(sessionId);
      sp.offOutput(sessionId);
      sp.closeSession(sessionId);
      ctx.sessionStreamingContent.delete(sessionId);
      ctx.sessionPendingUsage.delete(sessionId);
      ctx.sessionCommandSubmitter.delete(sessionId);
      ctx.sessionListeners.delete(sessionId);
      ctx.sessionStartTimes.delete(sessionId);
      ctx.sessionProviders.delete(sessionId);
      ctx.sessionEventBuffers.delete(sessionId);
      ctx.flushStreamingThrottle(sessionId);
      clearAiPauseState(sessionId);

      // Release all file locks held by this session
      await releaseAllSessionLocks(sessionId).catch((err) => {
        console.error("[file-lock] Error releasing session locks:", err);
      });

      // Cancel all queued operations for this session
      cancelAllSessionQueuedOps(sessionId);

      // Clean up upload files from disk
      try {
        const DATA_DIR = process.env.DATA_DIR ?? "./data";
        const uploadDir = path.join(DATA_DIR, "uploads", sessionId);
        if (fs.existsSync(uploadDir)) {
          fs.rmSync(uploadDir, { recursive: true, force: true });
        }
      } catch { /* ignore cleanup errors */ }

      await deleteSession(sessionId);
    } catch (err: unknown) {
      console.error("[db] Failed to delete session:", err);
    }
    try {
      const sessions = await listSessions(email);
      socket.emit("claude:sessions", { sessions });
    } catch {
      socket.emit("claude:sessions", { sessions: [] });
    }
  });

  socket.on(
    "claude:update_session_tags",
    async ({ sessionId, tags }: { sessionId: string; tags: string[] }) => {
      try {
        const session = await getSession(sessionId);
        if (!session || session.created_by !== email) return;
        await updateSessionTags(sessionId, tags);
      } catch (err: unknown) {
        console.error("[db] update_session_tags failed:", err);
        socket.emit("claude:error", { sessionId, message: "Failed to update session tags." });
      }
      try {
        const sessions = await listSessions(email);
        socket.emit("claude:sessions", { sessions });
      } catch {
        socket.emit("claude:sessions", { sessions: [] });
      }
    },
  );

  socket.on("claude:close_session", async ({ sessionId }: { sessionId: string }) => {
    if (!(await canModifySession(sessionId, email))) {
      socket.emit("claude:error", { sessionId, message: "Access denied" });
      return;
    }
    const sp = ctx.getSessionProvider(sessionId);
    // Suspend instead of close — preserves claudeSessionId for --resume
    sp.suspendSession(sessionId);
    await ctx.setSessionStatus(sessionId, "idle");
    ctx.sessionListeners.delete(sessionId);
    ctx.sessionStreamingContent.delete(sessionId);
    ctx.sessionPendingUsage.delete(sessionId);
    ctx.sessionCommandSubmitter.delete(sessionId);
  });

  // ── Model switching ────────────────────────────────────────────────────

  socket.on(
    "claude:set_model",
    async ({ sessionId, model }: { sessionId: string; model: string }) => {
      try {
        if (!(await canModifySession(sessionId, email))) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }
        if (!AVAILABLE_MODELS.some((m) => m.value === model)) {
          socket.emit("claude:error", { sessionId, message: "Invalid model" });
          return;
        }
        await updateSessionModel(sessionId, model);
        io.to(`session:${sessionId}`).emit("claude:model_changed", { sessionId, model });
      } catch (err) {
        socket.emit("claude:error", { sessionId, message: String(err) });
      }
    },
  );

  // ── Lightweight session rejoin (reconnection) ─────────────────────
  // Re-joins the socket room and re-attaches the output listener.
  // Always calls createSession (idempotent via getOrCreate) so that
  // after a server restart the provider session is re-initialized
  // and subsequent messages work. For sessions still alive in memory,
  // createSession just updates lastActivity without destroying the
  // claudeSessionId or conversation context.
  socket.on(
    "claude:rejoin_session",
    async ({ sessionId }: { sessionId: string }) => {
      if (!(await canAccessSession(sessionId, email))) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }

      const dbSession = await getSession(sessionId);
      if (!dbSession) {
        socket.emit("claude:error", { sessionId, message: "Session not found" });
        return;
      }

      ctx.roomManager.switchTo(sessionId, email);

      const sessionProvider = ctx.getSessionProvider(sessionId, dbSession.provider_type);

      // Only rebuild system prompt + call createSession when the provider
      // has no in-memory state (e.g. after server restart). If the session
      // is still alive in memory, just re-attach the listener.
      const hasResumeId = sessionProvider.getClaudeSessionId?.(sessionId) != null;
      if (!hasResumeId) {
        const rejoinSettings = await getUserSettings(email);
        const rejoinGroupPerms = isAdmin ? null : await getUserGroupPermissions(email);
        const rejoinUserGroup = isAdmin ? null : await getUserGroup(email);
        const systemPrompt = await buildSystemPrompt({
          personality: dbSession.personality ?? undefined,
          communicationStyle: rejoinGroupPerms?.prompt?.communication_style || "expert",
          autoSummary: rejoinSettings.auto_summary,
          sessionId,
          groupPermissions: rejoinGroupPerms,
          groupName: rejoinUserGroup?.name,
          groupPromptAppend: rejoinGroupPerms?.prompt?.system_prompt_append || undefined,
        });
        sessionProvider.createSession(sessionId, {
          skipPermissions: dbSession.skip_permissions,
          model: dbSession.model,
          userEmail: email,
          ...(systemPrompt ? { systemPrompt } : {}),
          ...(dbSession.claude_session_id ? { claudeSessionId: dbSession.claude_session_id } : {}),
        });
      }

      ctx.ensureSessionListener(sessionId);

      // Event replay is handled by claude:get_messages (always called alongside rejoin).
      // Replaying here too caused duplicate messages on the client.
      socket.emit("claude:session_ready", {
        sessionId,
        running: sessionProvider.isRunning(sessionId),
        status: sessionProvider.isRunning(sessionId) ? "running" : "idle",
      });
    },
  );

  // ── Runtime timer reset ────────────────────────────────────────────
  // Resets the session's runtime start time so users can continue after
  // hitting the rate_limit_runtime_min limit.
  socket.on("claude:reset_runtime", async ({ sessionId }: { sessionId: string }) => {
    if (!(await canAccessSession(sessionId, email))) {
      socket.emit("claude:error", { sessionId, message: "Access denied" });
      return;
    }
    ctx.sessionStartTimes.set(sessionId, Date.now());
    socket.emit("claude:runtime_reset", { sessionId });
  });

  // ── Session state sync (reconnection) ─────────────────────────────
  socket.on(
    "claude:get_session_state",
    async ({ sessionId }: { sessionId: string }) => {
      if (!(await canAccessSession(sessionId, email))) {
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

  // ── Session health check ────────────────────────────────────────────
  socket.on(
    "claude:check_session_health",
    async ({ sessionId }: { sessionId: string }) => {
      if (!(await canAccessSession(sessionId, email))) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      const sp = ctx.getSessionProvider(sessionId);
      const alive = sp.hasSession?.(sessionId) ?? true;
      const streamActive = alive && sp.isRunning(sessionId);
      socket.emit("claude:session_health", {
        sessionId,
        alive,
        streamActive,
        hasResumeId: sp.getClaudeSessionId?.(sessionId) != null,
      });
    },
  );

  // ── Token usage ──────────────────────────────────────────────────────

  socket.on(
    "claude:get_usage",
    async ({ sessionId }: { sessionId: string }) => {
      try {
        if (!(await canAccessSession(sessionId, email))) {
          socket.emit("claude:error", { sessionId, message: "Access denied" });
          return;
        }
        const usage = await getSessionTokenUsage(sessionId);
        const budgetLimits = {
          session_usd: parseFloat(await getAppSetting("budget_limit_session_usd", "0")),
          daily_usd: parseFloat(await getAppSetting("budget_limit_daily_usd", "0")),
          monthly_usd: parseFloat(await getAppSetting("budget_limit_monthly_usd", "0")),
        };
        socket.emit("claude:session_usage", { sessionId, usage, budgetLimits });
      } catch (err) {
        socket.emit("claude:error", { sessionId, message: String(err) });
      }
    },
  );

  socket.on("claude:get_global_usage", async ({ since, userId }: { since?: string; userId?: string }) => {
    try {
      const effectiveUserId = isAdmin ? userId : email;
      const usage = await getGlobalTokenUsage({ since, userId: effectiveUserId });
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
      const allSessionIds = new Set([
        ...ctx.sessionStreamingContent.keys(),
        ...ctx.sessionProviders.keys(),
      ]);
      for (const sid of allSessionIds) {
        try {
          const provider = ctx.sessionProviders.get(sid) ?? ctx.provider;
          provider.interrupt(sid);
        } catch { /* ignore */ }
        ctx.sessionStreamingContent.delete(sid);
        ctx.sessionListeners.delete(sid);
        ctx.sessionProviders.delete(sid);
        ctx.sessionCommandSubmitter.delete(sid);
        ctx.sessionPendingUsage.delete(sid);
        ctx.sessionStartTimes.delete(sid);
        ctx.sessionEventBuffers.delete(sid);
        ctx.flushStreamingThrottle(sid);
        clearAiPauseState(sid);
      }
      await logActivity("kill_all", email);
      socket.emit("claude:kill_all_done", { killed: allSessionIds.size });
      io.emit("claude:sessions_aborted");

      // Notify all admins
      const admins = await dbAll<{ email: string }>("SELECT email FROM users WHERE is_admin = 1");
      for (const admin of admins) {
        dispatchNotification("kill_all_triggered", admin.email, "Kill-all triggered", `All active sessions were terminated by ${email}.`).catch(() => {});
      }
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Settings handlers ─────────────────────────────────────────────────

  socket.on("claude:get_settings", async () => {
    try {
      const s = await getUserSettings(email);
      socket.emit("claude:settings", { settings: s });
    } catch { /* ignore */ }
  });

  socket.on(
    "claude:update_settings",
    async (data: Partial<{ full_trust_mode: boolean; custom_default_context: string | null; auto_naming_enabled: boolean }>) => {
      try {
        const updated = await updateUserSettings(email, data);
        socket.emit("claude:settings", { settings: updated });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  // ── Template handlers ──────────────────────────────────────────────────

  socket.on("claude:list_templates", async () => {
    try {
      const templates = await listTemplates();
      socket.emit("claude:templates", { templates });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on(
    "claude:create_template",
    async (data: { name: string; description?: string; system_prompt?: string; model?: string; skip_permissions?: boolean; provider_type?: string; icon?: string; is_default?: boolean }) => {
      if (!isAdmin) {
        socket.emit("claude:error", { message: "Admin access required" });
        return;
      }
      try {
        await createTemplate(data, email);
        const templates = await listTemplates();
        socket.emit("claude:templates", { templates });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:update_template",
    async ({ templateId, data }: { templateId: string; data: Partial<{ name: string; description: string; system_prompt: string; model: string; skip_permissions: boolean; provider_type: string; icon: string; is_default: boolean }> }) => {
      if (!isAdmin) {
        socket.emit("claude:error", { message: "Admin access required" });
        return;
      }
      try {
        await updateTemplate(templateId, data);
        const templates = await listTemplates();
        socket.emit("claude:templates", { templates });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:delete_template", async ({ templateId }: { templateId: string }) => {
    if (!isAdmin) {
      socket.emit("claude:error", { message: "Admin access required" });
      return;
    }
    try {
      await deleteTemplate(templateId);
      const templates = await listTemplates();
      socket.emit("claude:templates", { templates });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Session sharing ────────────────────────────────────────────────────

  /** Emit updated session list to all currently-connected sockets for a given user email. */
  async function pushSessionsToUser(targetEmail: string) {
    try {
      const updatedSessions = await listSessions(targetEmail);
      for (const [socketId, info] of ctx.connectedUsers.entries()) {
        if (info.email === targetEmail) {
          io.to(socketId).emit("claude:sessions", { sessions: updatedSessions });
        }
      }
    } catch { /* best-effort */ }
  }

  socket.on("claude:invite_to_session", async ({ sessionId, inviteEmail }: { sessionId: string; inviteEmail: string }) => {
    try {
      if (!(await canModifySession(sessionId, email))) {
        socket.emit("claude:error", { sessionId, message: "Only session owner or admin can invite" });
        return;
      }
      await addSessionParticipant(sessionId, inviteEmail);
      const participants = await listSessionParticipants(sessionId);
      socket.emit("claude:session_participants", { sessionId, participants });
      // Push real-time update to the invited user's connected sockets
      await pushSessionsToUser(inviteEmail);
      // Notify the invited user with a dedicated event and in-app notification
      const invitedSession = await getSession(sessionId);
      const sessionLabel = invitedSession?.name ?? "a session";
      for (const [socketId, info] of ctx.connectedUsers.entries()) {
        if (info.email === inviteEmail) {
          io.to(socketId).emit("claude:session_invited", {
            sessionId,
            sessionName: invitedSession?.name ?? null,
            invitedBy: email,
          });
        }
      }
      dispatchNotification(
        "session_invited",
        inviteEmail,
        "You've been invited to a session",
        `${email} invited you to join "${sessionLabel}". Open your session list to get started.`,
      ).catch(() => {});
    } catch {
      socket.emit("claude:error", { sessionId, message: "Failed to invite user" });
    }
  });

  socket.on("claude:remove_from_session", async ({ sessionId, removeEmail }: { sessionId: string; removeEmail: string }) => {
    try {
      if (!(await canModifySession(sessionId, email)) && removeEmail !== email) {
        socket.emit("claude:error", { sessionId, message: "Only session owner or admin can remove" });
        return;
      }
      await removeSessionParticipant(sessionId, removeEmail);
      const participants = await listSessionParticipants(sessionId);
      socket.emit("claude:session_participants", { sessionId, participants });
      // Push real-time removal to the removed user's connected sockets
      await pushSessionsToUser(removeEmail);
      // Also tell the removed user to deactivate the session if they have it open
      for (const [socketId, info] of ctx.connectedUsers.entries()) {
        if (info.email === removeEmail && info.activeSession === sessionId) {
          io.to(socketId).emit("claude:session_removed", { sessionId });
        }
      }
    } catch {
      socket.emit("claude:error", { sessionId, message: "Failed to remove user" });
    }
  });

  socket.on("claude:list_session_participants", async ({ sessionId }: { sessionId: string }) => {
    try {
      if (!(await canAccessSession(sessionId, email))) {
        socket.emit("claude:error", { sessionId, message: "Access denied" });
        return;
      }
      socket.emit("claude:session_participants", { sessionId, participants: await listSessionParticipants(sessionId) });
    } catch {
      socket.emit("claude:error", { sessionId, message: "Failed to list participants" });
    }
  });
}
