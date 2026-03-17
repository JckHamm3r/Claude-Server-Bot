"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Check, AlertCircle, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { cn, apiUrl } from "@/lib/utils";

interface ValidationState {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  passwordsMatch: boolean;
}

export default function ChangePasswordPage() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.push("/login");
    }
  }, [session, router]);

  const validation: ValidationState = {
    minLength: newPassword.length >= 12,
    hasUppercase: /[A-Z]/.test(newPassword),
    hasLowercase: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword),
    passwordsMatch: newPassword === confirmPassword && confirmPassword.length > 0,
  };

  const allValid =
    validation.minLength &&
    validation.hasUppercase &&
    validation.hasLowercase &&
    validation.hasNumber &&
    validation.hasSpecial &&
    validation.passwordsMatch;

  const getPasswordStrength = () => {
    const validCount = Object.values(validation).filter(Boolean).length;
    if (validCount <= 2) return { label: "Weak", color: "text-bot-red", bg: "bg-bot-red" };
    if (validCount <= 4) return { label: "Medium", color: "text-bot-amber", bg: "bg-bot-amber" };
    return { label: "Strong", color: "text-bot-green", bg: "bg-bot-green" };
  };

  const strength = getPasswordStrength();

  const handleSave = async () => {
    if (!allValid) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(apiUrl("/api/users/password/force-change"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change password");
      }

      await update();
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
      setSaving(false);
    }
  };

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bot-bg p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg rounded-xl border border-bot-border bg-bot-surface shadow-glass"
      >
        <div className="px-6 py-6 border-b border-bot-border/60">
          <h1 className="text-title font-bold text-bot-text mb-2">Password Change Required</h1>
          <p className="text-body text-bot-muted">
            Your administrator has reset your password. Please create a new password to continue.
          </p>
        </div>

        <div className="px-6 py-6 space-y-4">
          <div>
            <label className="block text-caption font-medium text-bot-muted mb-2">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 pr-10 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent"
                placeholder="Enter new password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-bot-muted hover:text-bot-text"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-caption font-medium text-bot-muted mb-2">
              Confirm New Password
            </label>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 pr-10 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent"
                placeholder="Confirm new password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-bot-muted hover:text-bot-text"
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {newPassword.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-caption text-bot-muted">Password strength</span>
                <span className={cn("text-caption font-medium", strength.color)}>
                  {strength.label}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-bot-elevated overflow-hidden">
                <motion.div
                  className={cn("h-full", strength.bg)}
                  initial={{ width: 0 }}
                  animate={{
                    width:
                      strength.label === "Weak"
                        ? "33%"
                        : strength.label === "Medium"
                          ? "66%"
                          : "100%",
                  }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-bot-border/40 bg-bot-elevated/30 p-3 space-y-2">
            <p className="text-caption font-medium text-bot-muted mb-2">Password requirements:</p>
            <ValidationItem label="At least 12 characters" valid={validation.minLength} />
            <ValidationItem label="One uppercase letter (A-Z)" valid={validation.hasUppercase} />
            <ValidationItem label="One lowercase letter (a-z)" valid={validation.hasLowercase} />
            <ValidationItem label="One number (0-9)" valid={validation.hasNumber} />
            <ValidationItem label="One special character (!@#$%...)" valid={validation.hasSpecial} />
            <ValidationItem
              label="Passwords match"
              valid={validation.passwordsMatch}
              show={confirmPassword.length > 0}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-bot-red/40 bg-bot-red/10 px-3 py-2">
              <AlertCircle className="h-4 w-4 text-bot-red shrink-0 mt-0.5" />
              <p className="text-caption text-bot-red">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-bot-border/60">
          <button
            onClick={handleSave}
            disabled={!allValid || saving}
            className="rounded-lg bg-bot-accent px-6 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
          >
            {saving ? "Changing Password..." : "Change Password"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ValidationItem({
  label,
  valid,
  show = true,
}: {
  label: string;
  valid: boolean;
  show?: boolean;
}) {
  if (!show) return null;

  return (
    <div className="flex items-center gap-2">
      {valid ? (
        <Check className="h-3.5 w-3.5 text-bot-green shrink-0" />
      ) : (
        <div className="h-3.5 w-3.5 rounded-full border border-bot-muted/40 shrink-0" />
      )}
      <span className={cn("text-caption", valid ? "text-bot-text" : "text-bot-muted")}>
        {label}
      </span>
    </div>
  );
}
