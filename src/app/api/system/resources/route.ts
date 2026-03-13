import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { execFileSync } from "child_process";
import os from "os";
import db from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // CPU
  const loadAvg = os.loadavg();
  const cpuCount = os.cpus().length;
  const cpu_pct = Math.min(100, Math.round((loadAvg[0] / cpuCount) * 100));

  // RAM
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ram_pct = Math.round((usedMem / totalMem) * 100);
  const ram_used_mb = Math.round(usedMem / 1024 / 1024);
  const ram_total_mb = Math.round(totalMem / 1024 / 1024);

  // Disk
  let disk_pct = 0;
  let disk_used_gb = 0;
  let disk_total_gb = 0;
  try {
    const dfOutput = execFileSync("df", ["-k", "/"], { encoding: "utf8" });
    const lines = dfOutput.trim().split("\n");
    // Second line has the data
    const parts = lines[1].trim().split(/\s+/);
    // df -k columns: Filesystem, 1K-blocks, Used, Available, Use%, Mounted on
    const totalKb = parseInt(parts[1], 10);
    const usedKb = parseInt(parts[2], 10);
    disk_total_gb = Math.round((totalKb / 1024 / 1024) * 10) / 10;
    disk_used_gb = Math.round((usedKb / 1024 / 1024) * 10) / 10;
    disk_pct = Math.round((usedKb / totalKb) * 100);
  } catch {
    // leave defaults
  }

  return NextResponse.json({
    cpu_pct,
    ram_pct,
    ram_used_mb,
    ram_total_mb,
    disk_pct,
    disk_used_gb,
    disk_total_gb,
  });
}
