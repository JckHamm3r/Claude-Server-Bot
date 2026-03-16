import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { execFileSync, spawn } from "child_process";
import path from "path";

const SERVICE_NAME = "claude-bot";

function requireAdmin() {
  return db.prepare("SELECT is_admin FROM users WHERE email = ?");
}

async function checkAuth(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = requireAdmin().get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

export async function GET() {
  const auth = await checkAuth();
  if ("error" in auth) return auth.error;

  let status: "active" | "inactive" | "unknown" = "unknown";
  let uptime: string | null = null;

  try {
    const out = execFileSync("systemctl", ["is-active", `${SERVICE_NAME}.service`], {
      encoding: "utf8",
    }).trim();
    status = out === "active" ? "active" : "inactive";
  } catch {
    // systemctl exits non-zero for non-active states
    status = "inactive";
  }

  // Try to get service uptime via show
  try {
    const show = execFileSync(
      "systemctl",
      ["show", `${SERVICE_NAME}.service`, "--property=ActiveEnterTimestamp"],
      { encoding: "utf8" },
    ).trim();
    const match = show.match(/ActiveEnterTimestamp=(.+)/);
    if (match && match[1] && match[1] !== "n/a") {
      uptime = match[1];
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ status, uptime, serviceName: SERVICE_NAME });
}

export async function POST(req: Request) {
  const auth = await checkAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as { action?: string };
  const action = body.action ?? "restart";

  if (action !== "restart" && action !== "stop" && action !== "start") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Check if systemd is available
  let hasSystemd = false;
  try {
    execFileSync("systemctl", ["is-system-running"], { encoding: "utf8", stdio: "pipe" });
    hasSystemd = true;
  } catch {
    // systemctl may exit non-zero but still work; check if it exists
    try {
      execFileSync("which", ["systemctl"], { encoding: "utf8" });
      hasSystemd = true;
    } catch {
      hasSystemd = false;
    }
  }

  if (!hasSystemd) {
    return NextResponse.json(
      { ok: false, message: "systemd is not available on this system." },
      { status: 422 },
    );
  }

  // Spawn detached so the service restart doesn't kill this response
  const installDir = process.cwd();
  const child = spawn(
    "bash",
    [
      "-c",
      `sleep 1 && sudo systemctl ${action} ${SERVICE_NAME}.service`,
    ],
    {
      cwd: installDir,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
    },
  );
  child.unref();

  return NextResponse.json({ ok: true, message: `Service ${action} initiated. Reconnect in a few seconds.` });
}

export async function PATCH(_req: Request) {
  const auth = await checkAuth();
  if ("error" in auth) return auth.error;

  // Trigger update: run update.sh in a detached process
  const installDir = path.resolve(process.cwd());
  const updateScript = path.join(installDir, "update.sh");

  let scriptExists = false;
  try {
    execFileSync("test", ["-f", updateScript]);
    scriptExists = true;
  } catch {
    try {
      const { existsSync } = await import("fs");
      scriptExists = existsSync(updateScript);
    } catch {
      scriptExists = false;
    }
  }

  if (!scriptExists) {
    return NextResponse.json({ ok: false, message: "update.sh not found in install directory." }, { status: 422 });
  }

  const child = spawn(
    "bash",
    ["-c", `sleep 2 && bash "${updateScript}" --non-interactive 2>&1 | tee /tmp/claude-bot-update.log`],
    {
      cwd: installDir,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
    },
  );
  child.unref();

  return NextResponse.json({
    ok: true,
    message: "Update started. The server will restart automatically when complete.",
    logFile: "/tmp/claude-bot-update.log",
  });
}
