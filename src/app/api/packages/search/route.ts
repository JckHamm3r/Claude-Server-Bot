import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { execFileSync } from "child_process";

async function checkAdmin(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!user?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

interface SearchResult {
  name: string;
  version: string;
  description: string;
  installed: boolean;
}

// GET /api/packages/search?q=<query>
export async function GET(req: Request) {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results: SearchResult[] = [];

  // Try apt-cache search
  try {
    execFileSync("which", ["apt-cache"], { encoding: "utf8", stdio: "pipe" });

    // Get installed packages set
    const installedSet = new Set<string>();
    try {
      const dpkgOut = execFileSync("dpkg-query", ["-W", "-f=${Package}\n"], {
        encoding: "utf8",
        stdio: "pipe",
      });
      for (const line of dpkgOut.split("\n")) {
        const name = line.trim();
        if (name) installedSet.add(name);
      }
    } catch {
      // ignore
    }

    const raw = execFileSync("apt-cache", ["search", q], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 10000,
    });

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const idx = line.indexOf(" - ");
      if (idx === -1) continue;
      const name = line.slice(0, idx).trim();
      const description = line.slice(idx + 3).trim();

      // Get version info
      let version = "";
      try {
        const show = execFileSync("apt-cache", ["show", name, "--no-all-versions"], {
          encoding: "utf8",
          stdio: "pipe",
          timeout: 3000,
        });
        const vMatch = show.match(/^Version:\s*(.+)$/m);
        if (vMatch) version = vMatch[1].trim();
      } catch {
        // ignore
      }

      results.push({ name, version, description, installed: installedSet.has(name) });
      if (results.length >= 50) break;
    }

    return NextResponse.json({ results, packageManager: "apt" });
  } catch {
    // apt-cache not available
  }

  // Try dnf/yum search
  for (const pm of ["dnf", "yum"]) {
    try {
      execFileSync("which", [pm], { encoding: "utf8", stdio: "pipe" });

      const raw = execFileSync(pm, ["search", q], {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 15000,
      });

      for (const line of raw.split("\n")) {
        const m = line.match(/^(\S+)\.\S+\s+:\s+(.+)/);
        if (!m) continue;
        results.push({ name: m[1], version: "", description: m[2].trim(), installed: false });
        if (results.length >= 50) break;
      }

      return NextResponse.json({ results, packageManager: pm });
    } catch {
      // not available
    }
  }

  // Try pacman
  try {
    execFileSync("which", ["pacman"], { encoding: "utf8", stdio: "pipe" });
    const raw = execFileSync("pacman", ["-Ss", q], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 10000,
    });

    const lines = raw.split("\n");
    for (let i = 0; i < lines.length - 1; i += 2) {
      const header = lines[i];
      const desc = (lines[i + 1] ?? "").trim();
      const m = header.match(/^[^/]+\/(\S+)\s+(\S+)/);
      if (!m) continue;
      results.push({ name: m[1], version: m[2], description: desc, installed: header.includes("[installed]") });
      if (results.length >= 50) break;
    }

    return NextResponse.json({ results, packageManager: "pacman" });
  } catch {
    // not available
  }

  return NextResponse.json({ error: "No supported package manager found." }, { status: 422 });
}
