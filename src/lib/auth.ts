import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          // Import db lazily to avoid edge-runtime issues
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const db = (require("./db") as { default: import("better-sqlite3").Database }).default;
          const user = db.prepare("SELECT * FROM users WHERE email = ?").get(credentials.email) as
            | { email: string; hash: string; is_admin: number }
            | undefined;

          if (!user) return null;

          const valid = await bcrypt.compare(credentials.password, user.hash);
          if (!valid) return null;

          return {
            id: user.email,
            email: user.email,
            name: user.email,
            isAdmin: Boolean(user.is_admin),
          };
        } catch (err) {
          console.error("[auth] authorize error:", err);
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
  },

  pages: {
    signIn: "/login",
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email;
        token.isAdmin = (user as { isAdmin?: boolean }).isAdmin ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
