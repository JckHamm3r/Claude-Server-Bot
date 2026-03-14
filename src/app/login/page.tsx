"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { apiUrl } from "@/lib/utils";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

interface BotIdentity {
  name: string;
  tagline: string;
  avatar: string | null;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [botIdentity, setBotIdentity] = useState<BotIdentity>({
    name: "Claude Server Bot",
    tagline: "Sign in to continue",
    avatar: null,
  });

  useEffect(() => {
    const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
    const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
    const bp = slug ? `/${prefix}/${slug}` : "";
    fetch(`${bp}/api/bot-identity`)
      .then((r) => r.json())
      .then((d: BotIdentity) => setBotIdentity(d))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    if (result?.error) {
      if (result.error.includes("IP_BLOCKED")) {
        setError("Access denied — too many failed attempts. Please try again later.");
      } else {
        setError("Invalid email or password");
      }
      setLoading(false);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } else {
      window.location.href = callbackUrl;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        x: shake ? [0, -6, 6, -4, 4, -2, 2, 0] : 0,
      }}
      transition={{
        opacity: { duration: 0.5 },
        y: { duration: 0.5, ease: "easeOut" },
        scale: { duration: 0.5, ease: "easeOut" },
        x: { duration: 0.4, ease: "easeInOut" },
      }}
      className="w-full max-w-sm"
    >
      <div className="glass-heavy rounded-2xl p-8 shadow-glass">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-5">
            <div className="absolute -inset-1.5 rounded-full gradient-accent opacity-50 blur-md animate-pulse" />
            <div className="relative h-20 w-20 rounded-full overflow-hidden border-2 border-bot-accent/30">
              {botIdentity.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={botIdentity.avatar} alt={botIdentity.name} className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={apiUrl("/avatars/waiting.png")} alt="Claude" className="h-full w-full object-cover" />
              )}
            </div>
          </div>
          <h1 className="text-title font-bold text-bot-text tracking-tight">{botIdentity.name}</h1>
          <p className="text-body text-bot-muted mt-1">{botIdentity.tagline}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-caption font-medium text-bot-muted mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full rounded-xl border border-bot-border bg-bot-elevated/60 px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/60 outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label className="block text-caption font-medium text-bot-muted mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-xl border border-bot-border bg-bot-elevated/60 px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/60 outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-caption text-bot-red flex items-center gap-1.5"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-bot-red" />
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </span>
            ) : (
              "Sign in"
            )}
          </button>
        </form>
      </div>

      <p className="text-center text-caption text-bot-muted/40 mt-6">
        Secured connection
      </p>
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center gradient-mesh-bg px-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-bot-accent/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-bot-accent-2/5 blur-3xl" />
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
