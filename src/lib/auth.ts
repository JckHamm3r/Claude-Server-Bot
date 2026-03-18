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
import { dbGet, dbRun } from "./db";

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

          if (ipSettings.enabled) {
            const block = await isIPBlocked(ip);
            if (block.blocked) {
              throw new Error(`IP_BLOCKED: ${block.reason ?? "Too many failed attempts"}`);
            }
          }

          const user = await dbGet<{ email: string; hash: string; is_admin: number }>(
            "SELECT * FROM users WHERE email = ?",
            [credentials.email]
          );

          if (!user) {
            if (ipSettings.enabled) {
              await recordLoginAttempt(ip, credentials.email, false);
              const count = await getFailedAttemptCount(ip, ipSettings.windowMinutes);
              if (count >= ipSettings.maxAttempts) {
                await blockIP(ip, "Too many failed login attempts", "temporary", ipSettings.blockDurationMinutes, "system");
                await logActivity("security_ip_blocked", null, { ip, attempts: count });
                try {
                  const { dispatchNotification } = await import("./notifications");
                  const admins = await dbGet<{ email: string }[]>("SELECT email FROM users WHERE is_admin = 1");
                  const adminList = Array.isArray(admins) ? admins : (admins ? [admins] : []);
                  for (const admin of adminList) {
                    dispatchNotification("security_ip_blocked", admin.email, "IP Blocked — Brute Force Detected", `IP ${ip} was automatically blocked after ${count} failed login attempts.`).catch(() => {});
                  }
                } catch { /* ignore */ }
              }
              await logActivity("security_failed_login", credentials.email, { ip });
            }
            return null;
          }

          const valid = await bcrypt.compare(credentials.password, user.hash);
          if (!valid) {
            if (ipSettings.enabled) {
              await recordLoginAttempt(ip, credentials.email, false);
              const count = await getFailedAttemptCount(ip, ipSettings.windowMinutes);
              if (count >= ipSettings.maxAttempts) {
                await blockIP(ip, "Too many failed login attempts", "temporary", ipSettings.blockDurationMinutes, "system");
                await logActivity("security_ip_blocked", null, { ip, attempts: count });
                try {
                  const { dispatchNotification } = await import("./notifications");
                  const admins = await dbGet<{ email: string }[]>("SELECT email FROM users WHERE is_admin = 1");
                  const adminList = Array.isArray(admins) ? admins : (admins ? [admins] : []);
                  for (const admin of adminList) {
                    dispatchNotification("security_ip_blocked", admin.email, "IP Blocked — Brute Force Detected", `IP ${ip} was automatically blocked after ${count} failed login attempts.`).catch(() => {});
                  }
                } catch { /* ignore */ }
              }
              await logActivity("security_failed_login", credentials.email, { ip });
            }
            return null;
          }

          if (ipSettings.enabled) {
            await recordLoginAttempt(ip, credentials.email, true);
          }

          try {
            const { getUserEffectiveAllowedIPs } = await import("./claude-db");
            const { isIPInAllowList } = await import("./ip-allowlist");
            const allowedIPs = await getUserEffectiveAllowedIPs(credentials.email);
            if (allowedIPs.length > 0 && !isIPInAllowList(ip, allowedIPs)) {
              await logActivity("security_ip_restricted_login", credentials.email, { ip });
              throw new Error(`IP_NOT_ALLOWED: Access from ${ip} is not permitted for this account`);
            }
          } catch (ipErr) {
            const ipErrMsg = String(ipErr);
            if (ipErrMsg.includes("IP_NOT_ALLOWED:")) throw ipErr;
          }

          await logActivity("user_login", user.email);

          return {
            id: user.email,
            email: user.email,
            name: user.email,
            isAdmin: Boolean(user.is_admin),
          };
        } catch (err) {
          const msg = String(err);
          if (msg.includes("IP_BLOCKED:")) throw err;
          if (msg.includes("IP_NOT_ALLOWED:")) throw err;
          console.error("[auth] authorize error:", err);
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60,
  },

  pages: {
    signIn: "/login",
  },

  callbacks: {
    async jwt({ token, user }) {
      const REFRESH_INTERVAL = 5 * 60 * 1000;
      const lastRefresh = (token.lastRefresh as number) ?? 0;
      const shouldRefresh = !!user || (Date.now() - lastRefresh > REFRESH_INTERVAL);

      if (user) {
        token.email = user.email;
        token.isAdmin = (user as { isAdmin?: boolean }).isAdmin ?? false;
      }

      if (shouldRefresh) {
        try {
          const row = await dbGet<{ is_admin: number; first_name: string; last_name: string; must_change_password: number; group_id: string | null }>(
            "SELECT is_admin, first_name, last_name, must_change_password, group_id FROM users WHERE email = ?",
            [token.email as string]
          );
          if (row) {
            token.isAdmin = Boolean(row.is_admin);
            token.firstName = row.first_name ?? "";
            token.lastName = row.last_name ?? "";
            token.mustChangePassword = Boolean(row.must_change_password);
            token.groupId = row.group_id ?? null;
          }

          try {
            const { getUserEffectiveAllowedIPs } = await import("./claude-db");
            token.allowedIps = await getUserEffectiveAllowedIPs(token.email as string);
          } catch {
            token.allowedIps = [];
          }

          if (!token.isAdmin) {
            token.setupComplete = true;
            await dbRun("INSERT OR IGNORE INTO user_settings (email) VALUES (?)", [token.email as string]);
            await dbRun("UPDATE user_settings SET setup_complete = 1 WHERE email = ?", [token.email as string]);
          } else {
            const globalSetup = await dbGet<{ value: string }>(
              "SELECT value FROM app_settings WHERE key = 'setup_complete'"
            );
            token.setupComplete = globalSetup?.value === "true";
          }

          token.lastRefresh = Date.now();
        } catch {
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
        (session.user as { groupId: string | null }).groupId = (token.groupId as string | null) ?? null;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
      const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
      const basePath = slug ? `/${prefix}/${slug}` : "";
      
      if (url === baseUrl || url === `${baseUrl}/`) {
        return `${baseUrl}${basePath}/`;
      }
      
      if (url.startsWith("/") && !url.startsWith(basePath)) {
        return `${baseUrl}${basePath}${url}`;
      }
      
      return url;
    },
  },

  cookies: {
    sessionToken: {
      name: (process.env.NEXTAUTH_URL ?? "").startsWith("https")
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: ((process.env.NEXTAUTH_URL ?? "").startsWith("https") ? "none" : "lax") as "none" | "lax",
        path: "/",
        secure: (process.env.NEXTAUTH_URL ?? "").startsWith("https"),
      },
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
