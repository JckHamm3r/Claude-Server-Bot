import { NextRequest, NextResponse } from "next/server";
import { runSubAgent, MAX_DELEGATION_DEPTH } from "@/lib/sub-agent-runner";
import { getActiveAgents } from "@/lib/claude-db";
import { getOrCreateInternalSecret } from "@/lib/agent-tool-injector";

function validateSecret(req: NextRequest): boolean {
  const secret = getOrCreateInternalSecret();
  const provided = req.headers.get("x-internal-secret");
  return provided === secret;
}

// GET — list active agents
export async function GET(req: NextRequest) {
  if (!validateSecret(req)) {
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
  if (!validateSecret(req)) {
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
