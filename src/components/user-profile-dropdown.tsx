"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { User, LogOut, KeyRound, Image as ImageIcon } from "lucide-react";
import { apiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { ChangeAvatarModal } from "./modals/change-avatar-modal";
import { ChangePasswordModal } from "./modals/change-password-modal";

export function UserProfileDropdown() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const userEmail = session?.user?.email ?? "";
  const userName = (session?.user as { name?: string })?.name ?? "";
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userEmail) return;
    fetch(apiUrl(`/api/users?email=${encodeURIComponent(userEmail)}`))
      .then(r => r.json())
      .then(data => {
        if (data.user?.avatar_url) {
          setAvatarUrl(data.user.avatar_url);
        }
      })
      .catch(() => {});
  }, [userEmail]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleLogout = () => {
    signOut({ callbackUrl: "/login" });
  };

  if (!session) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-center rounded-lg p-1.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-colors duration-200"
        aria-label="User profile menu"
      >
        <div className="relative h-7 w-7 rounded-full border-2 border-bot-border bg-bot-surface overflow-hidden">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={userName || userEmail}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-bot-accent/10">
              <User className="h-4 w-4 text-bot-accent" />
            </div>
          )}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-bot-border bg-bot-surface shadow-glass overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-bot-border/60">
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-12 rounded-full border-2 border-bot-border bg-bot-surface overflow-hidden shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={userName || userEmail}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-bot-accent/10">
                      <User className="h-6 w-6 text-bot-accent" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {userName && (
                    <p className="text-body font-semibold text-bot-text truncate">
                      {userName}
                    </p>
                  )}
                  <p className="text-caption text-bot-muted truncate">{userEmail}</p>
                </div>
              </div>
            </div>

            <div className="py-1">
              <button
                onClick={() => {
                  setShowAvatarModal(true);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-body text-bot-text hover:bg-bot-elevated/40 transition-colors"
              >
                <ImageIcon className="h-4 w-4 text-bot-muted" />
                Change Avatar
              </button>
              <button
                onClick={() => {
                  setShowPasswordModal(true);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-body text-bot-text hover:bg-bot-elevated/40 transition-colors"
              >
                <KeyRound className="h-4 w-4 text-bot-muted" />
                Change Password
              </button>
            </div>

            <div className="border-t border-bot-border/60 py-1">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-body text-bot-red hover:bg-bot-red/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showAvatarModal && (
        <ChangeAvatarModal
          open={showAvatarModal}
          onClose={() => setShowAvatarModal(false)}
          currentAvatar={avatarUrl}
          onAvatarChange={setAvatarUrl}
        />
      )}

      {showPasswordModal && (
        <ChangePasswordModal
          open={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
        />
      )}
    </div>
  );
}
