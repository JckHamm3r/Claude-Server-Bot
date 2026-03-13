"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

interface BotIdentity {
  name: string;
  tagline: string;
  avatar: string | null;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
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
    } else {
      router.push(callbackUrl);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center mb-8">
        <div className="h-14 w-14 rounded-full overflow-hidden mb-4 border border-bot-border">
          {botIdentity.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={botIdentity.avatar} alt={botIdentity.name} className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/claude-code.png" alt="Claude" className="h-full w-full object-cover" />
          )}
        </div>
        <h1 className="text-title font-semibold text-bot-text">{botIdentity.name}</h1>
        <p className="text-caption text-bot-muted mt-1">{botIdentity.tagline}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-caption font-medium text-bot-muted mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2.5 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors"
            placeholder="admin@example.com"
          />
        </div>

        <div>
          <label className="block text-caption font-medium text-bot-muted mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2.5 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="text-caption text-bot-red">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !email || !password}
          className="w-full rounded-lg bg-bot-accent px-4 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bot-bg px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
