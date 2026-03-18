import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import dns from "dns/promises";
import http from "http";
import { dbGet } from "@/lib/db";

async function getServerPublicIp(): Promise<string | null> {
  const sources = [
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
  ];
  for (const url of sources) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const ip = (await res.text()).trim();
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
      }
    } catch {
      // try next source
    }
  }
  return null;
}

async function checkPort80(hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname, port: 80, path: "/", timeout: 5000 },
      () => { req.destroy(); resolve(true); }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const hostname = searchParams.get("hostname")?.trim();

  if (!hostname) {
    return NextResponse.json({ error: "Missing hostname" }, { status: 400 });
  }

  const hostnameRegex =
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (!hostnameRegex.test(hostname)) {
    return NextResponse.json({ error: "Invalid hostname format" }, { status: 400 });
  }

  // Run DNS resolution, server IP detection, and port check concurrently
  const [resolvedResult, serverIpResult, port80Result] = await Promise.allSettled([
    (async () => {
      const v4 = await dns.resolve4(hostname).catch(() => [] as string[]);
      const v6 = await dns.resolve6(hostname).catch(() => [] as string[]);
      return [...v4, ...v6];
    })(),
    getServerPublicIp(),
    checkPort80(hostname),
  ]);

  const ips: string[] =
    resolvedResult.status === "fulfilled" ? resolvedResult.value : [];
  const srvIp: string | null =
    serverIpResult.status === "fulfilled" ? serverIpResult.value : null;
  const port80: boolean =
    port80Result.status === "fulfilled" ? port80Result.value : false;

  const dnsResolved = ips.length > 0;
  const ipMatch = Boolean(srvIp && ips.includes(srvIp));

  // Build human-readable diagnostic messages
  const issues: string[] = [];
  const hints: string[] = [];

  if (!dnsResolved) {
    issues.push(`${hostname} does not resolve to any IP address yet.`);
    hints.push(
      srvIp
        ? `Create an A record for ${hostname} pointing to ${srvIp}.`
        : "Create an A record pointing to your server's public IP."
    );
  } else if (!ipMatch && srvIp) {
    issues.push(
      `${hostname} resolves to ${ips.join(", ")}, but this server's IP is ${srvIp}.`
    );
    hints.push(`Update the A record for ${hostname} to point to ${srvIp}.`);
  }

  if (dnsResolved && !port80) {
    issues.push("Port 80 is not reachable from outside this server.");
    hints.push(
      "Ensure port 80 (HTTP) is open in your firewall or cloud security group. " +
        "Let's Encrypt requires inbound port 80 to issue certificates."
    );
  }

  const ready = dnsResolved && ipMatch && port80;

  return NextResponse.json({
    hostname,
    dns_resolved: dnsResolved,
    resolved_ips: ips,
    server_ip: srvIp,
    ip_match: ipMatch,
    port80_open: port80,
    ready,
    issues,
    hints,
  });
}
