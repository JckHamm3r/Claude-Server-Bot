import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { execFileSync, spawn } from "child_process";

const DANGER_UNITS = new Set([
  "sshd.service",
  "ssh.service",
  "networking.service",
  "network.service",
  "network-online.target",
  "NetworkManager.service",
  "systemd-networkd.service",
  "systemd-resolved.service",
  "udev.service",
  "systemd-udevd.service",
  "dbus.service",
  "dbus-broker.service",
  "init.service",
  "systemd-journald.service",
  "systemd-logind.service",
  "kernel-core.service",
]);

async function checkAdminExpert(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = db
    .prepare("SELECT u.is_admin, COALESCE(us.experience_level, 'expert') as experience_level FROM users u LEFT JOIN user_settings us ON u.email = us.email WHERE u.email = ?")
    .get(session.user.email) as { is_admin: number; experience_level?: string } | undefined;
  if (!user?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if ((user.experience_level ?? "expert") !== "expert") {
    return { error: NextResponse.json({ error: "Forbidden: Expert level required" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

function sanitizeUnit(unit: string): string {
  // Only allow valid systemd unit name chars
  return unit.replace(/[^a-zA-Z0-9._@\-:]/g, "");
}

function getShowProps(unit: string, userUnit = false): Record<string, string> {
  const props: Record<string, string> = {};
  const args = [
    ...(userUnit ? ["--user"] : []),
    "show",
    unit,
    "--no-pager",
    "--property=ActiveState,SubState,LoadState,UnitFileState,Description,ExecStart,FragmentPath,MainPID,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestamp,InactiveEnterTimestamp,NRestarts,Restart,User,WorkingDirectory,Environment,WantedBy,After,Requires,PartOf",
  ];
  try {
    const out = execFileSync("systemctl", args, { encoding: "utf8", timeout: 8000 });
    for (const line of out.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) {
        props[line.slice(0, idx)] = line.slice(idx + 1).trim();
      }
    }
  } catch {
    // ignore
  }
  return props;
}

export async function GET(req: Request, { params }: { params: Promise<{ unit: string }> }) {
  const auth = await checkAdminExpert();
  if ("error" in auth) return auth.error;

  const { unit: rawUnit } = await params;
  const unit = sanitizeUnit(decodeURIComponent(rawUnit));
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "system";
  const userUnit = type === "user";

  const action = url.searchParams.get("action");

  if (action === "journal") {
    const lines = parseInt(url.searchParams.get("lines") ?? "500", 10);
    const since = url.searchParams.get("since") ?? "";
    const priority = url.searchParams.get("priority") ?? "";
    try {
      const args = [
        "-u",
        unit,
        "-n",
        String(Math.min(lines, 500)),
        "--no-pager",
        "--output=short-iso",
      ];
      if (since) args.push("--since", since);
      if (priority) args.push("-p", priority);
      const out = execFileSync("journalctl", args, { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
      return NextResponse.json({ logs: out });
    } catch {
      return NextResponse.json({ logs: "" });
    }
  }

  if (action === "unit-file") {
    try {
      const fragmentOut = execFileSync(
        "systemctl",
        [...(userUnit ? ["--user"] : []), "cat", unit, "--no-pager"],
        { encoding: "utf8", timeout: 8000 },
      );
      return NextResponse.json({ content: fragmentOut });
    } catch {
      return NextResponse.json({ content: "" });
    }
  }

  // Default: show service detail
  const props = getShowProps(unit, userUnit);

  // Is this a danger unit?
  const isDanger = DANGER_UNITS.has(unit);

  return NextResponse.json({
    unit,
    isDanger,
    type,
    ...props,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ unit: string }> }) {
  const auth = await checkAdminExpert();
  if ("error" in auth) return auth.error;

  const { unit: rawUnit } = await params;
  const unit = sanitizeUnit(decodeURIComponent(rawUnit));
  const body = await req.json().catch(() => ({})) as { action?: string; type?: string };
  const action = body.action;
  const userUnit = (body.type ?? "system") === "user";

  if (!["start", "stop", "restart", "reload", "enable", "disable", "mask", "unmask"].includes(action ?? "")) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Check systemd availability
  try {
    execFileSync("which", ["systemctl"], { encoding: "utf8" });
  } catch {
    return NextResponse.json({ ok: false, error: "systemctl not available" }, { status: 422 });
  }

  // For start/stop/restart/reload: detach so we can respond before the action completes
  // (especially important for restart which kills the current process if it's our own service)
  const sudoParts = userUnit ? [] : ["sudo"];
  const systemctlArgs = [...(userUnit ? ["--user"] : []), action!, unit];

  const needsDetach = ["start", "stop", "restart"].includes(action!);

  if (needsDetach) {
    const cmd = [...sudoParts, "systemctl", ...systemctlArgs].join(" ");
    const child = spawn("bash", ["-c", `sleep 0.5 && ${cmd}`], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
    });
    child.unref();
    return NextResponse.json({ ok: true, message: `${action} initiated for ${unit}` });
  }

  // enable/disable/mask/unmask: run inline (fast, no restart involved)
  try {
    execFileSync(
      "bash",
      ["-c", [...sudoParts, "systemctl", ...systemctlArgs].join(" ")],
      { encoding: "utf8", timeout: 10000 },
    );
    return NextResponse.json({ ok: true, message: `${action} successful for ${unit}` });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
