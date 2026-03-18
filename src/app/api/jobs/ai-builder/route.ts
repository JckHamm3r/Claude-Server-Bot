import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUserAdmin } from "@/lib/claude-db";
import { getAppSetting } from "@/lib/app-settings";

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isUserAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { messages, systemContext } = body as {
      messages: ChatMessage[];
      systemContext: string;
    };

    const apiKey = (await getAppSetting("anthropic_api_key")) || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Anthropic API key not configured" }, { status: 500 });
    }

    const anthropicMessages = messages.map((m: ChatMessage) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    if (anthropicMessages.length === 0) {
      anthropicMessages.push({ role: "user", content: "Hello, I'd like to create a scheduled job." });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemContext,
        messages: anthropicMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[ai-builder] Anthropic API error:", err);
      return NextResponse.json({ error: "AI service error" }, { status: 502 });
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const reply = data.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("") ?? "I'm sorry, I couldn't generate a response.";

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[ai-builder] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
