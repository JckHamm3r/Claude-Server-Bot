import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

function getApiKey(): string {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'anthropic_api_key'").get() as { value: string } | undefined;
    if (row?.value) return row.value;
  } catch { /* fallback to env */ }
  return process.env.ANTHROPIC_API_KEY ?? "";
}

function getBotName(): string {
  try {
    const row = db.prepare("SELECT name FROM bot_settings WHERE id = 1").get() as { name: string } | undefined;
    return row?.name ?? "Claude";
  } catch {
    return "Claude";
  }
}

interface RefactorResult {
  title: string;
  content: string;
}

async function refactorMemory(title: string, content: string, apiKey: string): Promise<RefactorResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a knowledge-base curator. Your job is to improve a single memory item so it is clearer, more precise, and easier for an AI assistant to use as project context.

Rules:
- Rewrite the title to be a concise, specific noun phrase (3–8 words). It should describe exactly what the memory is about.
- Rewrite the content to be accurate, self-contained, and scannable. Fix grammar and remove redundancy. Preserve all factual details.
- Do not add information that wasn't implied by the original. Do not remove key facts.
- Return ONLY valid JSON with exactly two fields: "title" (string) and "content" (string). No explanation.

Memory to improve:
Title: ${title}
Content:
${content}

Return JSON:`,
        },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { content?: { type: string; text: string }[] };
  const rawText = data?.content?.[0]?.text?.trim() ?? "";

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI did not return valid JSON");

  const parsed = JSON.parse(jsonMatch[0]) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).title !== "string" ||
    typeof (parsed as Record<string, unknown>).content !== "string"
  ) {
    throw new Error("AI response missing required fields");
  }

  const result = parsed as { title: string; content: string };
  return {
    title: result.title.trim(),
    content: result.content.trim(),
  };
}

// POST /api/claude-code/memories/refactor
// Body: { title: string; content: string }
// Returns: { title: string; content: string; botName: string }
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Anthropic API key configured. Set it in Admin > Settings." },
      { status: 422 }
    );
  }

  let body: { title: string; content: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, content } = body;
  if (!title?.trim() && !content?.trim()) {
    return NextResponse.json({ error: "Nothing to refactor" }, { status: 400 });
  }

  let result: RefactorResult;
  try {
    result = await refactorMemory(title ?? "", content ?? "", apiKey);
  } catch (err) {
    console.error("[memories/refactor] AI error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI refactor failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ...result, botName: getBotName() });
}
