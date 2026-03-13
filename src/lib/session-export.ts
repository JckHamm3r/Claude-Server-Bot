import type { ClaudeSession, ClaudeMessage } from "./claude-db";

export function exportToMarkdown(session: ClaudeSession, messages: ClaudeMessage[]): string {
  const lines: string[] = [];
  lines.push(`# ${session.name ?? "Untitled Session"}`);
  lines.push("");
  lines.push(`- **Session ID**: ${session.id}`);
  lines.push(`- **Created**: ${session.created_at}`);
  lines.push(`- **Model**: ${session.model}`);
  if (session.tags.length > 0) {
    lines.push(`- **Tags**: ${session.tags.join(", ")}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    if (msg.message_type === "system") continue;
    const sender = msg.sender_type === "admin" ? "User" : "Claude";
    const time = new Date(msg.timestamp).toLocaleString();
    lines.push(`### ${sender} (${time})`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}

export function exportToJSON(session: ClaudeSession, messages: ClaudeMessage[]): string {
  return JSON.stringify(
    {
      session: {
        id: session.id,
        name: session.name,
        model: session.model,
        tags: session.tags,
        created_at: session.created_at,
        updated_at: session.updated_at,
        created_by: session.created_by,
      },
      messages: messages.map((m) => ({
        id: m.id,
        sender_type: m.sender_type,
        content: m.content,
        message_type: m.message_type,
        timestamp: m.timestamp,
        metadata: m.metadata,
      })),
      exported_at: new Date().toISOString(),
    },
    null,
    2,
  );
}
