import db from "../db";

function getApiKey(): string {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'anthropic_api_key'").get() as { value: string } | undefined;
    if (row?.value) return row.value;
  } catch { /* fallback to env */ }
  return process.env.ANTHROPIC_API_KEY ?? "";
}

/**
 * Ask Haiku to generate a short descriptive session title from the first
 * user message and (optionally) the beginning of Claude's reply.
 * Falls back to a truncated version of the user message on any error.
 */
export async function generateSessionName(
  userMessage: string,
  assistantReply?: string,
): Promise<string> {
  const fallback = userMessage.trim().slice(0, 50) || "New Session";

  const apiKey = getApiKey();
  if (!apiKey) return fallback;

  const replySnippet = assistantReply
    ? `\n\nAssistant reply (excerpt): ${assistantReply.slice(0, 300)}`
    : "";

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-latest",
        max_tokens: 30,
        messages: [
          {
            role: "user",
            content: `Generate a short, descriptive title (3-6 words) for a chat session that started with this message. Return ONLY the title, no quotes, no punctuation at the end.\n\nUser message: ${userMessage.slice(0, 500)}${replySnippet}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return fallback;

    const data = await res.json();
    const title = data?.content?.[0]?.text?.trim();
    if (!title || title.length > 60) return fallback;
    return title;
  } catch {
    return fallback;
  }
}
