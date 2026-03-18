import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClaudeProvider } from "@/lib/claude";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const provider = getClaudeProvider();

  const start = Date.now();

  try {
    provider.createSession(sessionId, { skipPermissions: true });

    const result = await new Promise<{ ok: boolean; latency: number; error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        provider.offOutput(sessionId);
        provider.closeSession(sessionId);
        resolve({ ok: false, latency: Date.now() - start, error: "Timeout after 15s" });
      }, 15000);

      provider.onOutput(sessionId, (parsed) => {
        if (parsed.type === "text" || parsed.type === "streaming") {
          // Got a response — success
        }
        if (parsed.type === "done") {
          clearTimeout(timeout);
          provider.offOutput(sessionId);
          provider.closeSession(sessionId);
          resolve({ ok: true, latency: Date.now() - start });
        }
        if (parsed.type === "error") {
          clearTimeout(timeout);
          provider.offOutput(sessionId);
          provider.closeSession(sessionId);
          resolve({ ok: false, latency: Date.now() - start, error: parsed.message });
        }
      });

      provider.sendMessage(sessionId, 'Respond with exactly: ready');
    });

    return NextResponse.json(result);
  } catch (err) {
    provider.offOutput(sessionId);
    provider.closeSession(sessionId);
    return NextResponse.json({ ok: false, latency: Date.now() - start, error: String(err) });
  }
}
