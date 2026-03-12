import type { Metadata } from "next";
import "./globals.css";
import { NextAuthProvider } from "@/providers/session-provider";

export const metadata: Metadata = {
  title: "Claude Server Bot",
  description: "Claude Code interface for your server",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bot-bg text-bot-text font-sans antialiased">
        <NextAuthProvider>
          {children}
        </NextAuthProvider>
      </body>
    </html>
  );
}
