import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { getAppSetting } from "@/lib/app-settings";

interface MemoryRow {
  id: string;
  title: string;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ParsedMemory {
  title: string;
  content: string;
}

async function getApiKey(): Promise<string> {
  try {
    const value = await getAppSetting("anthropic_api_key", "");
    if (value) return value;
  } catch { /* fallback to env */ }
  return process.env.ANTHROPIC_API_KEY ?? "";
}

async function parseMemoryFromText(text: string, apiKey: string): Promise<ParsedMemory> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are a knowledge-base curator. Extract a single memory item from the user's freeform text.

Rules:
- Title: concise noun phrase (3–8 words) describing what should be remembered.
- Content: the factual information to remember, cleaned up for clarity. Preserve all details.
- Do not add information that wasn't implied by the original.
- Return ONLY valid JSON with exactly two fields: "title" (string) and "content" (string). No explanation.

Text to remember:
${text}

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

// POST /api/claude-code/memories/remember
// Body: { text: string }
// Returns: { memory: MemoryRow }
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Anthropic API key configured. Set it in Admin > Settings." },
      { status: 422 }
    );
  }

  let body: { text: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { text } = body;
  if (!text?.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  let parsed: ParsedMemory;
  try {
    parsed = await parseMemoryFromText(text.trim(), apiKey);
  } catch (err) {
    console.error("[memories/remember] AI error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI parsing failed" },
      { status: 500 }
    );
  }

  const memory = await dbGet<MemoryRow>(
    "INSERT INTO memories (title, content, created_by) VALUES (?, ?, ?) RETURNING id, title, content, created_by, created_at, updated_at",
    [parsed.title, parsed.content, session.user.email]
  );

  return NextResponse.json({ memory }, { status: 201 });
}
