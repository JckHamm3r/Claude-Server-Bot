/**
 * Edge-compatible IP allowlist utilities (no Node.js-specific APIs).
 * Supports IPv4, IPv6, and CIDR notation for both.
 */

export interface CIDRValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

// ─── IPv4 helpers ────────────────────────────────────────────────────────────

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const byte = parseInt(part, 10);
    if (isNaN(byte) || byte < 0 || byte > 255 || String(byte) !== part) return null;
    n = (n << 8) | byte;
  }
  return n >>> 0;
}

function isValidIPv4(ip: string): boolean {
  return ipv4ToNumber(ip) !== null;
}

function isIPv4InCIDR(ip: string, network: string, prefix: number): boolean {
  const ipNum = ipv4ToNumber(ip);
  const netNum = ipv4ToNumber(network);
  if (ipNum === null || netNum === null) return false;
  if (prefix === 32) return ipNum === netNum;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) >>> 0 === (netNum & mask) >>> 0;
}

// ─── IPv6 helpers ────────────────────────────────────────────────────────────

function expandIPv6(ip: string): string | null {
  // Handle IPv4-mapped IPv6 (e.g., ::ffff:192.168.1.1)
  if (ip.includes(".")) {
    const lastColon = ip.lastIndexOf(":");
    const ipv4Part = ip.slice(lastColon + 1);
    if (!isValidIPv4(ipv4Part)) return null;
    const ipv4Num = ipv4ToNumber(ipv4Part)!;
    const high = (ipv4Num >>> 16).toString(16).padStart(4, "0");
    const low = (ipv4Num & 0xffff).toString(16).padStart(4, "0");
    ip = ip.slice(0, lastColon + 1) + high + ":" + low;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const expandHalf = (h: string) => (h === "" ? [] : h.split(":"));
  const left = expandHalf(halves[0]);
  const right = halves.length === 2 ? expandHalf(halves[1]) : [];

  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;

  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;

  const normalized = groups.map((g) => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    return g.padStart(4, "0");
  });

  if (normalized.some((g) => g === null)) return null;
  return (normalized as string[]).join(":");
}

function ipv6ToBigInt(ip: string): bigint | null {
  const expanded = expandIPv6(ip);
  if (!expanded) return null;
  const groups = expanded.split(":");
  let n = BigInt(0);
  for (const g of groups) {
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

function isValidIPv6(ip: string): boolean {
  return expandIPv6(ip) !== null;
}

function isIPv6InCIDR(ip: string, network: string, prefix: number): boolean {
  const ipNum = ipv6ToBigInt(ip);
  const netNum = ipv6ToBigInt(network);
  if (ipNum === null || netNum === null) return false;
  if (prefix === 128) return ipNum === netNum;
  if (prefix === 0) return true;
  const mask = ~((BigInt(1) << BigInt(128 - prefix)) - BigInt(1)) & ((BigInt(1) << BigInt(128)) - BigInt(1));
  return (ipNum & mask) === (netNum & mask);
}

// ─── CIDR parsing ────────────────────────────────────────────────────────────

interface ParsedCIDR {
  network: string;
  prefix: number;
  isV6: boolean;
}

function parseCIDR(cidr: string): ParsedCIDR | null {
  const slashIdx = cidr.indexOf("/");
  if (slashIdx === -1) {
    // Plain IP — treat as /32 or /128
    if (isValidIPv4(cidr)) return { network: cidr, prefix: 32, isV6: false };
    if (isValidIPv6(cidr)) return { network: cidr, prefix: 128, isV6: true };
    return null;
  }
  const network = cidr.slice(0, slashIdx);
  const prefixStr = cidr.slice(slashIdx + 1);
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || String(prefix) !== prefixStr) return null;

  if (isValidIPv4(network)) {
    if (prefix < 0 || prefix > 32) return null;
    return { network, prefix, isV6: false };
  }
  if (isValidIPv6(network)) {
    if (prefix < 0 || prefix > 128) return null;
    return { network, prefix, isV6: true };
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Returns true if `ip` is covered by the single CIDR/IP entry `cidr`. */
export function isIPInCIDR(ip: string, cidr: string): boolean {
  const parsed = parseCIDR(cidr);
  if (!parsed) return false;

  const ipIsV6 = isValidIPv6(ip) && !isValidIPv4(ip);
  const ipIsV4 = isValidIPv4(ip);

  if (!ipIsV4 && !ipIsV6) return false;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — check against IPv4 CIDR
  if (ipIsV6 && !parsed.isV6) {
    const expanded = expandIPv6(ip);
    if (expanded?.startsWith("0000:0000:0000:0000:0000:ffff:")) {
      const v4Part = expanded.slice(30).split(":").map((h) =>
        [(parseInt(h, 16) >>> 8) & 0xff, parseInt(h, 16) & 0xff].join(".")
      ).join(".");
      return isIPv4InCIDR(v4Part, parsed.network, parsed.prefix);
    }
    return false;
  }

  if (ipIsV4 && !parsed.isV6) return isIPv4InCIDR(ip, parsed.network, parsed.prefix);
  if (ipIsV6 && parsed.isV6) return isIPv6InCIDR(ip, parsed.network, parsed.prefix);
  return false;
}

/** Returns true if `ip` matches any entry in `allowList`. Empty list = no match. */
export function isIPInAllowList(ip: string, allowList: string[]): boolean {
  if (!allowList || allowList.length === 0) return false;
  const normalizedIP = ip.trim();
  for (const entry of allowList) {
    if (isIPInCIDR(normalizedIP, entry.trim())) return true;
  }
  return false;
}

/** Validate a single IP or CIDR string. Returns normalized form on success. */
export function validateIPOrCIDR(input: string): CIDRValidationResult {
  const trimmed = input.trim();
  if (!trimmed) return { valid: false, normalized: "", error: "Empty value" };

  const parsed = parseCIDR(trimmed);
  if (!parsed) {
    return {
      valid: false,
      normalized: trimmed,
      error: "Invalid IP address or CIDR notation",
    };
  }
  return { valid: true, normalized: trimmed };
}

/** Validate an array of IP/CIDR strings. Returns { valid, errors } where errors maps index → message. */
export function validateAllowList(entries: string[]): {
  valid: boolean;
  errors: Record<number, string>;
} {
  const errors: Record<number, string> = {};
  for (let i = 0; i < entries.length; i++) {
    const result = validateIPOrCIDR(entries[i]);
    if (!result.valid) errors[i] = result.error!;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Parse a JSON array of IPs stored in the DB, returning [] on failure. */
export function parseStoredIPs(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
