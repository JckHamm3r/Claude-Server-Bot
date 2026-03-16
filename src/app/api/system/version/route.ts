import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { execFileSync } from "child_process";

const GITHUB_REPO = "JckHamm3r/Claude-Server-Bot";

async function checkAuth(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = db
    .prepare("SELECT is_admin FROM users WHERE email = ?")
    .get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

export async function GET() {
  const auth = await checkAuth();
  if ("error" in auth) return auth.error;

  // Current commit
  let currentCommit = "unknown";
  let currentTag: string | null = null;
  try {
    currentCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      cwd: process.cwd(),
    }).trim();
  } catch {
    // ignore
  }
  try {
    currentTag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      encoding: "utf8",
      cwd: process.cwd(),
    }).trim();
  } catch {
    currentTag = null;
  }

  // Latest commit on remote main
  let latestCommit: string | null = null;
  let latestTag: string | null = null;
  let updateAvailable = false;
  let checkError: string | null = null;

  try {
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "claude-server-bot",
    };

    // Check latest commit on main
    const branchRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/branches/main`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (branchRes.ok) {
      const branchData = await branchRes.json() as { commit?: { sha?: string } };
      if (branchData.commit?.sha) {
        latestCommit = branchData.commit.sha.substring(0, 7);
        updateAvailable = latestCommit !== currentCommit;
      }
    }

    // Also check latest tag/release
    const releaseRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (releaseRes.ok) {
      const releaseData = await releaseRes.json() as { tag_name?: string };
      if (releaseData.tag_name) {
        latestTag = releaseData.tag_name;
      }
    }
  } catch (e) {
    checkError = e instanceof Error ? e.message : "Failed to reach GitHub";
  }

  // Installed date from git log
  let installedAt: string | null = null;
  try {
    installedAt = execFileSync(
      "git",
      ["log", "-1", "--format=%ci"],
      { encoding: "utf8", cwd: process.cwd() },
    ).trim();
  } catch {
    installedAt = null;
  }

  return NextResponse.json({
    currentCommit,
    currentTag,
    latestCommit,
    latestTag,
    updateAvailable,
    checkError,
    installedAt,
    repo: `https://github.com/${GITHUB_REPO}`,
  });
}
