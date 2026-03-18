import { execSync, exec } from "child_process";
import { getAppSettingSync as getAppSetting } from "./app-settings";

export interface Fail2BanStatus {
  available: boolean;
  running: boolean;
  version?: string;
  jailName: string;
  jailExists: boolean;
  bannedIPs: string[];
  error?: string;
}

export interface Fail2BanSettings {
  enabled: boolean;
  jail: string;
  syncIntervalSeconds: number;
}

export function getFail2BanSettings(): Fail2BanSettings {
  return {
    enabled: getAppSetting("fail2ban_enabled", "false") === "true",
    jail: getAppSetting("fail2ban_jail", "octoby-auth"),
    syncIntervalSeconds: parseInt(getAppSetting("fail2ban_sync_interval_seconds", "30"), 10),
  };
}

function runCmd(cmd: string, timeoutMs = 5000): { stdout: string; error?: string } {
  try {
    const stdout = execSync(cmd, {
      timeout: timeoutMs,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout: stdout.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: e.stdout?.trim() ?? "",
      error: e.stderr?.trim() || e.message || String(err),
    };
  }
}

export function isFail2BanAvailable(): boolean {
  const { error } = runCmd("which fail2ban-client");
  return !error;
}

export function isFail2BanRunning(): boolean {
  const { stdout, error } = runCmd("fail2ban-client ping");
  return !error && stdout.includes("pong");
}

export function getFail2BanVersion(): string | undefined {
  const { stdout } = runCmd("fail2ban-client --version");
  const match = stdout.match(/Fail2Ban v?(\S+)/i);
  return match?.[1];
}

export function getJailList(): string[] {
  const { stdout, error } = runCmd("fail2ban-client status");
  if (error || !stdout) return [];
  const match = stdout.match(/Jail list:\s*(.+)/i);
  if (!match) return [];
  return match[1].split(",").map((j) => j.trim()).filter(Boolean);
}

export function jailExists(jailName: string): boolean {
  return getJailList().includes(jailName);
}

export function getBannedIPs(jailName: string): string[] {
  const { stdout, error } = runCmd(`fail2ban-client status ${jailName}`);
  if (error || !stdout) return [];
  const match = stdout.match(/Banned IP list:\s*(.+)/i);
  if (!match || !match[1].trim()) return [];
  return match[1]
    .split(/\s+/)
    .map((ip) => ip.trim())
    .filter((ip) => ip && ip !== "");
}

export function banIP(jailName: string, ip: string): boolean {
  const { error } = runCmd(`fail2ban-client set ${jailName} banip ${ip}`);
  if (error) {
    console.error(`[fail2ban] banIP error for ${ip} in jail ${jailName}:`, error);
    return false;
  }
  return true;
}

export function unbanIP(jailName: string, ip: string): boolean {
  const { error } = runCmd(`fail2ban-client set ${jailName} unbanip ${ip}`);
  if (error) {
    console.error(`[fail2ban] unbanIP error for ${ip} in jail ${jailName}:`, error);
    return false;
  }
  return true;
}

export function getFail2BanStatus(): Fail2BanStatus {
  const settings = getFail2BanSettings();
  const jailName = settings.jail;

  const available = isFail2BanAvailable();
  if (!available) {
    return {
      available: false,
      running: false,
      jailName,
      jailExists: false,
      bannedIPs: [],
      error: "fail2ban-client not found in PATH",
    };
  }

  const running = isFail2BanRunning();
  if (!running) {
    return {
      available: true,
      running: false,
      version: getFail2BanVersion(),
      jailName,
      jailExists: false,
      bannedIPs: [],
      error: "fail2ban service is not running",
    };
  }

  const jailOk = jailExists(jailName);
  const bannedIPs = jailOk ? getBannedIPs(jailName) : [];

  return {
    available: true,
    running: true,
    version: getFail2BanVersion(),
    jailName,
    jailExists: jailOk,
    bannedIPs,
  };
}

// Async wrapper for banip/unbanip to avoid blocking the event loop
export function banIPAsync(jailName: string, ip: string): void {
  if (!isFail2BanAvailable()) return;
  exec(`fail2ban-client set ${jailName} banip ${ip}`, (err) => {
    if (err) console.error(`[fail2ban] async banIP error for ${ip}:`, err.message);
  });
}

export function unbanIPAsync(jailName: string, ip: string): void {
  if (!isFail2BanAvailable()) return;
  exec(`fail2ban-client set ${jailName} unbanip ${ip}`, (err) => {
    if (err) console.error(`[fail2ban] async unbanIP error for ${ip}:`, err.message);
  });
}
