import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { logActivity } from "./activity-log";
import {
  extractIP,
  isIPBlocked,
  recordLoginAttempt,
  getFailedAttemptCount,
  blockIP,
  getIPProtectionSettings,
} from "./ip-protection";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const ipSettings = getIPProtectionSettings();
          const ip = extractIP((req?.headers ?? {}) as Record<string, string | string[] | undefined>);

          // Check if IP is blocked
          if (ipSettings.enabled) {
            const block = isIPBlocked(ip);
            if (block.blocked) {
              throw new Error(`IP_BLOCKED: ${block.reason ?? "Too many failed attempts"}`);
            }
          }

          // Import db lazily to avoid edge-runtime issues
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const db = (require("./db") as { default: import("better-sqlite3").Database }).default;
          const user = db.prepare("SELECT * FROM users WHERE email = ?").get(credentials.email) as
            | { email: string; hash: string; is_admin: number }
            | undefined;

          if (!user) {
            if (ipSettings.enabled) {
              recordLoginAttempt(ip, credentials.email, false);
              const count = getFailedAttemptCount(ip, ipSettings.windowMinutes);
              if (count >= ipSettings.maxAttempts) {
                blockIP(ip, "Too many failed login attempts", "temporary", ipSettings.blockDurationMinutes, "system");
                logActivity("security_ip_blocked", null, { ip, attempts: count });
                // Dispatch notification to admins (lazy import to avoid circular deps)
                try {
                  const { dispatchNotification } = await import("./notifications");
                  const admins = db.prepare("SELECT email FROM users WHERE is_admin = 1").all() as { email: string }[];
                  for (const admin of admins) {
                    dispatchNotification("security_ip_blocked", admin.email, "IP Blocked — Brute Force Detected", `IP ${ip} was automatically blocked after ${count} failed login attempts.`).catch(() => {});
                  }
                } catch { /* ignore */ }
              }
              logActivity("security_failed_login", credentials.email, { ip });
            }
            return null;
          }

          const valid = await bcrypt.compare(credentials.password, user.hash);
          if (!valid) {
            if (ipSettings.enabled) {
              recordLoginAttempt(ip, credentials.email, false);
              const count = getFailedAttemptCount(ip, ipSettings.windowMinutes);
              if (count >= ipSettings.maxAttempts) {
                blockIP(ip, "Too many failed login attempts", "temporary", ipSettings.blockDurationMinutes, "system");
                logActivity("security_ip_blocked", null, { ip, attempts: count });
                try {
                  const { dispatchNotification } = await import("./notifications");
                  const admins = db.prepare("SELECT email FROM users WHERE is_admin = 1").all() as { email: string }[];
                  for (const admin of admins) {
                    dispatchNotification("security_ip_blocked", admin.email, "IP Blocked — Brute Force Detected", `IP ${ip} was automatically blocked after ${count} failed login attempts.`).catch(() => {});
                  }
                } catch { /* ignore */ }
              }
              logActivity("security_failed_login", credentials.email, { ip });
            }
            return null;
          }

          // Successful login
          if (ipSettings.enabled) {
            recordLoginAttempt(ip, credentials.email, true);
          }
          logActivity("user_login", user.email);

          return {
            id: user.email,
            email: user.email,
            name: user.email,
            isAdmin: Boolean(user.is_admin),
          };
        } catch (err) {
          const msg = String(err);
          if (msg.includes("IP_BLOCKED:")) throw err; // re-throw so NextAuth surfaces it
          console.error("[auth] authorize error:", err);
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },

  pages: {
    signIn: "/login",
  },

  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in (user object is present) OR on periodic refresh,
      // load the latest values from the database. Reading setupComplete only
      // on refresh meant every fresh login saw the setup wizard for up to 5 min.
      const REFRESH_INTERVAL = 5 * 60 * 1000;
      const lastRefresh = (token.lastRefresh as number) ?? 0;
      const shouldRefresh = !!user || (Date.now() - lastRefresh > REFRESH_INTERVAL);

      if (user) {
        token.email = user.email;
        token.isAdmin = (user as { isAdmin?: boolean }).isAdmin ?? false;
      }

      if (shouldRefresh) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const db = (require("./db") as { default: import("better-sqlite3").Database }).default;
          const row = db.prepare("SELECT is_admin, first_name, last_name, must_change_password FROM users WHERE email = ?").get(token.email as string) as
            | { is_admin: number; first_name: string; last_name: string; must_change_password: number }
            | undefined;
          if (row) {
            token.isAdmin = Boolean(row.is_admin);
            token.firstName = row.first_name ?? "";
            token.lastName = row.last_name ?? "";
            token.mustChangePassword = Boolean(row.must_change_password);
          }

          // Non-admin users don't go through the setup wizard.
          // Auto-mark their setup_complete on first encounter so the middleware
          // never redirects them to /setup.
          if (!token.isAdmin) {
            token.setupComplete = true;
            // Persist the flag so it survives JWT refreshes
            db.prepare("INSERT OR IGNORE INTO user_settings (email) VALUES (?)").run(token.email as string);
            db.prepare("UPDATE user_settings SET setup_complete = 1 WHERE email = ?").run(token.email as string);
          } else {
            const settings = db.prepare("SELECT setup_complete FROM user_settings WHERE email = ?").get(token.email as string) as
              | { setup_complete: number }
              | undefined;
            token.setupComplete = settings ? Boolean(settings.setup_complete) : false;
          }

          token.lastRefresh = Date.now();
        } catch {
          // DB unavailable in edge runtime — keep existing value
          if (user) token.lastRefresh = Date.now();
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
        (session.user as { isAdmin: boolean }).isAdmin = Boolean(token.isAdmin);
        (session.user as { firstName: string }).firstName = (token.firstName as string) ?? "";
        (session.user as { lastName: string }).lastName = (token.lastName as string) ?? "";
      }
      return session;
    },
  },

  cookies: {
    sessionToken: {
      name: (process.env.NEXTAUTH_URL ?? "").startsWith("https")
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "none" as const,
        path: "/",
        secure: (process.env.NEXTAUTH_URL ?? "").startsWith("https"),
      },
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
