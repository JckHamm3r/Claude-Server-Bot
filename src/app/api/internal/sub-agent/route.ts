import { NextRequest, NextResponse } from "next/server";
import { runSubAgent, MAX_DELEGATION_DEPTH } from "@/lib/sub-agent-runner";
import { getActiveAgents } from "@/lib/claude-db";
import { getOrCreateInternalSecret } from "@/lib/agent-tool-injector";

function isLocalRequest(req: NextRequest): boolean {
  // Allow requests from localhost only
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // If there's a forwarded-for header with non-local IP, reject
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp !== "127.0.0.1" && firstIp !== "::1") return false;
  }
  const host = req.headers.get("host") ?? "";
  return host.startsWith("localhost:") || host === "localhost" || host.startsWith("127.0.0.1:");
}

function validateSecret(req: NextRequest): boolean {
  const secret = getOrCreateInternalSecret();
  const provided = req.headers.get("x-internal-secret");
  return provided === secret;
}

// GET — list active agents
export async function GET(req: NextRequest) {
  if (!isLocalRequest(req) || !validateSecret(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const agents = (await getActiveAgents()).map((a) => ({
    name: a.name,
    description: a.description,
    icon: a.icon,
    model: a.model,
  }));

  return NextResponse.json({ agents });
}

// POST — run a sub-agent delegation
export async function POST(req: NextRequest) {
  if (!isLocalRequest(req) || !validateSecret(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    agentName: string;
    task: string;
    context?: string;
    parentSessionId: string;
    userEmail?: string;
    skipPermissions?: boolean;
    depth?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { agentName, task, context, parentSessionId, userEmail = "system", skipPermissions = true, depth = 0 } = body;

  if (!agentName || !task || !parentSessionId) {
    return NextResponse.json(
      { success: false, error: "agentName, task, and parentSessionId are required" },
      { status: 400 },
    );
  }

  if (depth >= MAX_DELEGATION_DEPTH) {
    return NextResponse.json({
      success: false,
      error: `Maximum delegation depth (${MAX_DELEGATION_DEPTH}) reached.`,
    });
  }

  try {
    const result = await runSubAgent({
      agentName,
      task,
      context,
      parentSessionId,
      userEmail,
      skipPermissions,
      delegationDepth: depth,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      success: false,
      result: "",
      costUsd: 0,
      error: String(err),
    });
  }
}
