import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbTransaction } from "@/lib/db";
import { getAppSetting } from "@/lib/app-settings";

async function getApiKey(): Promise<string> {
  try {
    const value = await getAppSetting("anthropic_api_key", "");
    if (value) return value;
  } catch { /* fallback to env */ }
  return process.env.ANTHROPIC_API_KEY ?? "";
}

interface ParsedMemory {
  title: string;
  content: string;
}

interface MemoryRow {
  id: string;
  title: string;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Uses Claude to parse a markdown file into individual memory items.
 * The AI identifies logical sections and converts each into a titled memory.
 */
async function parseMarkdownIntoMemories(mdContent: string, apiKey: string): Promise<ParsedMemory[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are a memory extraction assistant. Your job is to parse a markdown document and break it into individual, standalone memory items that can be saved as project context for an AI assistant.

Rules:
- Each memory item should be a distinct piece of information (a fact, procedure, preference, configuration detail, etc.)
- Give each memory a short, clear title (3-8 words)
- The content should be the relevant text, cleaned up and self-contained
- Aim for 1-20 memory items depending on the document's content
- If the document has clear sections or headers, use those as natural boundaries
- If it's a flat list, each item can become its own memory
- If it's a long narrative, identify the key facts/concepts as separate memories
- Return ONLY valid JSON: an array of objects with "title" and "content" fields
- Do not include any explanation or text outside the JSON array

Markdown document to parse:
\`\`\`markdown
${mdContent.slice(0, 8000)}
\`\`\`

Return JSON array:`,
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { content?: { type: string; text: string }[] };
  const rawText = data?.content?.[0]?.text?.trim() ?? "";

  // Extract JSON from the response (strip any markdown code fences if present)
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON array");
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("AI response is not an array");
  }

  return parsed
    .filter((item): item is { title: string; content: string } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).title === "string" &&
      typeof (item as Record<string, unknown>).content === "string"
    )
    .map((item) => ({
      title: item.title.trim(),
      content: item.content.trim(),
    }))
    .filter((item) => item.title && item.content);
}

// POST /api/claude-code/memories/import
// Body: { content: string } — the raw markdown text to import
// Returns: { memories: MemoryRow[], count: number }
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
      { error: "No Anthropic API key configured. Set it in Admin > Settings to use AI import." },
      { status: 422 }
    );
  }

  let body: { content: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { content } = body;
  if (!content?.trim()) {
    return NextResponse.json({ error: "Missing content" }, { status: 400 });
  }

  let parsedMemories: ParsedMemory[];
  try {
    parsedMemories = await parseMarkdownIntoMemories(content, apiKey);
  } catch (err) {
    console.error("[memories/import] AI parse error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI parsing failed" },
      { status: 500 }
    );
  }

  if (parsedMemories.length === 0) {
    return NextResponse.json({ error: "No memories could be extracted from the document" }, { status: 422 });
  }

  const email = session.user.email;
  const insertedMemories = await dbTransaction(async ({ get }) => {
    const results: MemoryRow[] = [];
    for (const m of parsedMemories) {
      const row = await get<MemoryRow>(
        "INSERT INTO memories (title, content, created_by, tags) VALUES (?, ?, ?, ?) RETURNING id, title, content, created_by, created_at, updated_at",
        [m.title, m.content, email, '[]']
      );
      if (row) results.push(row);
    }
    return results;
  });

  return NextResponse.json({ memories: insertedMemories, count: insertedMemories.length }, { status: 201 });
}
