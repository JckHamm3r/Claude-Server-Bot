"use client";

import { SessionProvider } from "next-auth/react";

export function NextAuthProvider({ children }: { children: React.ReactNode }) {
  const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
  const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
  const basePath = slug ? `/${prefix}/${slug}` : "";

  return (
    <SessionProvider basePath={`${basePath}/api/auth`}>
      {children}
    </SessionProvider>
  );
}
