import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { execFileSync, spawn } from "child_process";

async function checkAdmin(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

function detectPackageManager(): "apt" | "dnf" | "yum" | "pacman" | null {
  for (const pm of ["apt-get", "dnf", "yum", "pacman"] as const) {
    try {
      execFileSync("which", [pm], { encoding: "utf8", stdio: "pipe" });
      if (pm === "apt-get") return "apt";
      if (pm === "dnf") return "dnf";
      if (pm === "yum") return "yum";
      if (pm === "pacman") return "pacman";
    } catch {
      // not found
    }
  }
  return null;
}

interface PackageInfo {
  name: string;
  version: string;
  description: string;
  status: "installed" | "available";
  upgradable?: boolean;
}

function listInstalledApt(search: string): PackageInfo[] {
  try {
    const raw = execFileSync(
      "dpkg-query",
      ["-W", "-f=${Package}\t${Version}\t${binary:Summary}\n"],
      { encoding: "utf8", stdio: "pipe" },
    );
    const packages: PackageInfo[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [name, version, ...descParts] = line.split("\t");
      const description = descParts.join("\t").trim();
      if (
        !search ||
        name?.toLowerCase().includes(search.toLowerCase()) ||
        description?.toLowerCase().includes(search.toLowerCase())
      ) {
        packages.push({ name: name ?? "", version: version ?? "", description, status: "installed" });
      }
    }
    return packages.slice(0, 200);
  } catch {
    return [];
  }
}

function listInstalledDnf(search: string): PackageInfo[] {
  try {
    const raw = execFileSync("rpm", ["-qa", "--queryformat", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{SUMMARY}\n"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    const packages: PackageInfo[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [name, version, ...descParts] = line.split("\t");
      const description = descParts.join("\t").trim();
      if (
        !search ||
        name?.toLowerCase().includes(search.toLowerCase()) ||
        description?.toLowerCase().includes(search.toLowerCase())
      ) {
        packages.push({ name: name ?? "", version: version ?? "", description, status: "installed" });
      }
    }
    return packages.slice(0, 200);
  } catch {
    return [];
  }
}

function listInstalledPacman(search: string): PackageInfo[] {
  try {
    const raw = execFileSync("pacman", ["-Q"], { encoding: "utf8", stdio: "pipe" });
    const packages: PackageInfo[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const name = parts[0] ?? "";
      const version = parts[1] ?? "";
      if (!search || name.toLowerCase().includes(search.toLowerCase())) {
        packages.push({ name, version, description: "", status: "installed" });
      }
    }
    return packages.slice(0, 200);
  } catch {
    return [];
  }
}

function getUpgradableApt(): Set<string> {
  try {
    const raw = execFileSync("apt-get", ["--simulate", "upgrade"], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    });
    const upgradable = new Set<string>();
    for (const line of raw.split("\n")) {
      const m = line.match(/^Inst\s+(\S+)/);
      if (m) upgradable.add(m[1]);
    }
    return upgradable;
  } catch {
    return new Set();
  }
}

// GET /api/packages?search=<query>&filter=installed|all
export async function GET(req: Request) {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const filter = searchParams.get("filter") ?? "installed";

  const pm = detectPackageManager();
  if (!pm) {
    return NextResponse.json({ error: "No supported package manager found." }, { status: 422 });
  }

  let packages: PackageInfo[] = [];

  if (filter === "installed" || filter === "all") {
    if (pm === "apt") {
      packages = listInstalledApt(search);
      if (filter === "installed") {
        const upgradable = getUpgradableApt();
        packages = packages.map((p) => ({ ...p, upgradable: upgradable.has(p.name) }));
      }
    } else if (pm === "dnf" || pm === "yum") {
      packages = listInstalledDnf(search);
    } else if (pm === "pacman") {
      packages = listInstalledPacman(search);
    }
  }

  return NextResponse.json({ packages, packageManager: pm });
}

// POST /api/packages  — install
export async function POST(req: Request) {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").trim();
  if (!name || !/^[a-zA-Z0-9._+\-:]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid package name." }, { status: 400 });
  }

  const pm = detectPackageManager();
  if (!pm) {
    return NextResponse.json({ error: "No supported package manager found." }, { status: 422 });
  }

  let cmd: string;
  if (pm === "apt") {
    cmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y "${name}" 2>&1`;
  } else if (pm === "dnf") {
    cmd = `dnf install -y "${name}" 2>&1`;
  } else if (pm === "yum") {
    cmd = `yum install -y "${name}" 2>&1`;
  } else {
    cmd = `pacman -S --noconfirm "${name}" 2>&1`;
  }

  return new Promise<NextResponse>((resolve) => {
    const child = spawn("bash", ["-c", cmd], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
    });

    let output = "";
    child.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { output += d.toString(); });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(NextResponse.json({ ok: true, output: output.slice(-2000) }));
      } else {
        resolve(NextResponse.json({ ok: false, output: output.slice(-2000) }, { status: 500 }));
      }
    });

    child.on("error", (err) => {
      resolve(NextResponse.json({ ok: false, output: err.message }, { status: 500 }));
    });
  });
}

// DELETE /api/packages  — uninstall
export async function DELETE(req: Request) {
  const auth = await checkAdmin();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { name?: string; purge?: boolean };
  const name = (body.name ?? "").trim();
  if (!name || !/^[a-zA-Z0-9._+\-:]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid package name." }, { status: 400 });
  }

  const pm = detectPackageManager();
  if (!pm) {
    return NextResponse.json({ error: "No supported package manager found." }, { status: 422 });
  }

  const purge = body.purge === true;
  let cmd: string;
  if (pm === "apt") {
    cmd = `DEBIAN_FRONTEND=noninteractive apt-get ${purge ? "purge" : "remove"} -y "${name}" 2>&1`;
  } else if (pm === "dnf") {
    cmd = `dnf remove -y "${name}" 2>&1`;
  } else if (pm === "yum") {
    cmd = `yum remove -y "${name}" 2>&1`;
  } else {
    cmd = `pacman -R${purge ? "ns" : "n"} --noconfirm "${name}" 2>&1`;
  }

  return new Promise<NextResponse>((resolve) => {
    const child = spawn("bash", ["-c", cmd], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
    });

    let output = "";
    child.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { output += d.toString(); });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(NextResponse.json({ ok: true, output: output.slice(-2000) }));
      } else {
        resolve(NextResponse.json({ ok: false, output: output.slice(-2000) }, { status: 500 }));
      }
    });

    child.on("error", (err) => {
      resolve(NextResponse.json({ ok: false, output: err.message }, { status: 500 }));
    });
  });
}
