"use client";

import { useState, useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { Share2, UserPlus, X, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalShare {
  id: string;
  terminal_session_id: string;
  owner_email: string;
  invited_email: string;
  created_at: string;
}

interface ShareModalProps {
  tabId: string;
  tabName: string;
  onClose: () => void;
}

export function ShareModal({ tabId, tabName, onClose }: ShareModalProps) {
  const [shares, setShares] = useState<TerminalShare[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    const handleList = ({ tabId: tid, shares: s }: { tabId: string; shares: TerminalShare[] }) => {
      if (tid !== tabId) return;
      setShares(s);
    };

    const handleAdded = ({ tabId: tid, share }: { tabId: string; share: TerminalShare }) => {
      if (tid !== tabId) return;
      setShares((prev) => [...prev, share]);
      setLoading(false);
      setInviteEmail("");
    };

    const handleRevoked = ({ tabId: tid, invitedEmail }: { tabId: string; invitedEmail: string }) => {
      if (tid !== tabId) return;
      setShares((prev) => prev.filter((s) => s.invited_email !== invitedEmail));
    };

    const handleError = ({ message }: { message: string }) => {
      setError(message);
      setLoading(false);
    };

    socket.on("terminal:share:list", handleList);
    socket.on("terminal:share:added", handleAdded);
    socket.on("terminal:share:revoked", handleRevoked);
    socket.on("terminal:error", handleError);

    socket.emit("terminal:share:list", { tabId });

    return () => {
      socket.off("terminal:share:list", handleList);
      socket.off("terminal:share:added", handleAdded);
      socket.off("terminal:share:revoked", handleRevoked);
      socket.off("terminal:error", handleError);
    };
  }, [tabId]);

  const handleInvite = () => {
    if (!inviteEmail.trim()) return;
    setError(null);
    setLoading(true);
    const socket = getSocket();
    socket.emit("terminal:share:invite", { tabId, invitedEmail: inviteEmail.trim() });
  };

  const handleRevoke = (invitedEmail: string) => {
    const socket = getSocket();
    socket.emit("terminal:share:revoke", { tabId, invitedEmail });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-bot-surface rounded-xl border border-bot-border/60 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bot-border/40">
          <div className="flex items-center gap-2.5">
            <Share2 className="h-4 w-4 text-bot-accent" />
            <div>
              <h2 className="text-body font-semibold text-bot-text">Share Terminal</h2>
              <p className="text-caption text-bot-muted">{tabName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Invite input */}
          <div>
            <label className="block text-caption font-medium text-bot-text mb-1.5">
              Invite admin by email
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                placeholder="admin@example.com"
                className="flex-1 rounded-lg border border-bot-border/60 bg-bot-elevated/40 px-3 py-2 text-body text-bot-text placeholder:text-bot-muted focus:outline-none focus:border-bot-accent/60"
              />
              <button
                onClick={handleInvite}
                disabled={loading || !inviteEmail.trim()}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-caption font-medium transition-all",
                  "bg-bot-accent/15 text-bot-accent border border-bot-accent/30",
                  "hover:bg-bot-accent/25 hover:border-bot-accent/50",
                  "disabled:opacity-40 disabled:cursor-not-allowed"
                )}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Invite
              </button>
            </div>
            {error && <p className="mt-1.5 text-caption text-bot-red">{error}</p>}
            <p className="mt-1.5 text-caption text-bot-muted">
              Invited admins can view and type in this terminal in real time.
            </p>
          </div>

          {/* Current shares */}
          {shares.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="h-3.5 w-3.5 text-bot-muted" />
                <span className="text-caption font-medium text-bot-muted">Shared with</span>
              </div>
              <div className="space-y-1">
                {shares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2 bg-bot-elevated/40 border border-bot-border/30"
                  >
                    <span className="text-caption text-bot-text">{share.invited_email}</span>
                    <button
                      onClick={() => handleRevoke(share.invited_email)}
                      className="text-bot-muted hover:text-bot-red transition-colors"
                      title="Remove access"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {shares.length === 0 && (
            <p className="text-center text-caption text-bot-muted py-2">
              Not shared with anyone yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
