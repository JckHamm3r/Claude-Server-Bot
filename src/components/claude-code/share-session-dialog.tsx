"use client";

import { useState, useEffect, useCallback } from "react";
import { X, UserPlus, UserMinus, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";

interface Participant {
  user_email: string;
  role: string;
  invited_at: string;
}

interface ShareSessionDialogProps {
  sessionId: string;
  sessionName: string | null;
  onClose: () => void;
  readOnly?: boolean;
}

export function ShareSessionDialog({ sessionId, sessionName, onClose, readOnly = false }: ShareSessionDialogProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadParticipants = useCallback(() => {
    setLoading(true);
    const socket = getSocket();
    socket.emit("claude:list_session_participants", { sessionId });
  }, [sessionId]);

  useEffect(() => {
    const socket = getSocket();

    const handleParticipants = ({ sessionId: sid, participants: p }: { sessionId: string; participants: Participant[] }) => {
      if (sid === sessionId) {
        setParticipants(p);
        setLoading(false);
        setInviting(false);
        setRemovingEmail(null);
      }
    };

    const handleError = ({ sessionId: sid, message }: { sessionId?: string; message: string }) => {
      if (!sid || sid === sessionId) {
        setError(message);
        setInviting(false);
        setRemovingEmail(null);
      }
    };

    socket.on("claude:session_participants", handleParticipants);
    socket.on("claude:error", handleError);

    loadParticipants();

    return () => {
      socket.off("claude:session_participants", handleParticipants);
      socket.off("claude:error", handleError);
    };
  }, [sessionId, loadParticipants]);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setError(null);
    setSuccess(null);
    setInviting(true);
    const socket = getSocket();
    socket.emit("claude:invite_to_session", { sessionId, inviteEmail: email });
    setInviteEmail("");
    setSuccess(`Invited ${email}`);
    setTimeout(() => setSuccess(null), 3000);
  }

  function handleRemove(email: string) {
    setError(null);
    setRemovingEmail(email);
    const socket = getSocket();
    socket.emit("claude:remove_from_session", { sessionId, removeEmail: email });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl glass-heavy shadow-float border border-bot-border/40 overflow-hidden animate-scaleIn">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bot-border/30">
          <div className="flex items-center gap-2.5">
            <Users className="h-4 w-4 text-bot-accent" />
            <div>
              <h2 className="text-body font-semibold text-bot-text">Share Session</h2>
              {sessionName && (
                <p className="text-caption text-bot-muted truncate max-w-xs">{sessionName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {!readOnly && (
            <form onSubmit={handleInvite} className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors"
                disabled={inviting}
              />
              <button
                type="submit"
                disabled={!inviteEmail.trim() || inviting}
                className="flex items-center gap-1.5 rounded-lg bg-bot-accent px-3 py-2 text-caption font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
              >
                {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Invite
              </button>
            </form>
          )}

          {error && (
            <p className="text-caption text-bot-red bg-bot-red/10 rounded-lg px-3 py-2">{error}</p>
          )}
          {success && (
            <p className="text-caption text-bot-green bg-bot-green/10 rounded-lg px-3 py-2">{success}</p>
          )}

          <div>
            <p className="text-caption font-medium text-bot-muted mb-2">
              {loading ? "Loading participants…" : participants.length === 0 ? "No participants yet" : `${participants.length} participant${participants.length !== 1 ? "s" : ""}`}
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-bot-muted" />
              </div>
            ) : participants.length > 0 ? (
              <div className="rounded-xl border border-bot-border/40 overflow-hidden">
                {participants.map((p) => (
                  <div key={p.user_email} className="flex items-center justify-between px-4 py-3 border-b border-bot-border/30 last:border-b-0">
                    <div>
                      <p className="text-body text-bot-text">{p.user_email}</p>
                      <p className="text-caption text-bot-muted capitalize">
                        {p.role} · Added {new Date(p.invited_at).toLocaleDateString()}
                      </p>
                    </div>
                    {!readOnly && (
                      <button
                        onClick={() => handleRemove(p.user_email)}
                        disabled={removingEmail === p.user_email}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium transition-colors",
                          removingEmail === p.user_email
                            ? "opacity-50 cursor-not-allowed"
                            : "text-bot-muted hover:text-bot-red hover:bg-bot-red/10"
                        )}
                        title="Remove participant"
                      >
                        {removingEmail === p.user_email ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserMinus className="h-3.5 w-3.5" />
                        )}
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <p className="text-caption text-bot-muted/60">
            {readOnly
              ? "You are a guest collaborator. Only the session owner can manage participants."
              : "Participants can view and interact with this session. Only the owner can rename, delete, or manage participants."
            }
          </p>
        </div>
      </div>
    </div>
  );
}
