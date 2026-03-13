import type { Metadata } from "next";
import "./globals.css";
import { NextAuthProvider } from "@/providers/session-provider";
import { ToastProvider } from "@/components/ui/toast";

// Force all pages to be dynamically rendered so middleware auth checks always run
export const dynamic = "force-dynamic";

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
          <ToastProvider>
            {children}
          </ToastProvider>
        </NextAuthProvider>
      </body>
    </html>
  );
}
