import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { execFileSync } from "child_process";

async function checkAdminExpert(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
  if (!user?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

export interface SystemdUnit {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
  type: "system" | "user";
}

function listUnits(): SystemdUnit[] {
  const units: SystemdUnit[] = [];

  function parseUnits(output: string, type: "system" | "user"): void {
    const lines = output.split("\n");
    for (const line of lines) {
      // systemctl list-units --plain output:
      // UNIT LOAD ACTIVE SUB DESCRIPTION
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith("UNIT") || trimmed.startsWith("Legend") || trimmed.startsWith("To show") || trimmed.startsWith("LOAD") || trimmed.startsWith("ACTIVE")) continue;
      // Skip lines with leading legend bullets
      if (trimmed.startsWith("●")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) continue;
      const unit = parts[0];
      if (!unit.endsWith(".service")) continue;
      const load = parts[1];
      const active = parts[2];
      const sub = parts[3];
      const description = parts.slice(4).join(" ");
      units.push({ unit, load, active, sub, description, type });
    }
  }

  // System units
  try {
    const out = execFileSync(
      "systemctl",
      ["list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend"],
      { encoding: "utf8", timeout: 10000 },
    );
    parseUnits(out, "system");
  } catch {
    // systemctl may not be available
  }

  // User units
  try {
    const out = execFileSync(
      "systemctl",
      ["--user", "list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend"],
      { encoding: "utf8", timeout: 10000, env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? "" } },
    );
    parseUnits(out, "user");
  } catch {
    // user bus may not be available
  }

  return units;
}

export async function GET() {
  const auth = await checkAdminExpert();
  if ("error" in auth) return auth.error;

  const units = listUnits();
  return NextResponse.json({ units });
}
