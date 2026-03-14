import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let _basePath: string | null = null;

function getBasePath(): string {
  if (_basePath !== null) return _basePath;
  const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
  const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
  _basePath = slug ? `/${prefix}/${slug}` : "";
  return _basePath;
}

export function apiUrl(path: string): string {
  return `${getBasePath()}${path}`;
}

/**
 * Sanitize FTS5 snippet HTML: escape all entities first, then restore
 * our controlled highlight markers as <mark> tags.
 */
export function sanitizeSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  return escaped
    .replace(/\[\[highlight\]\]/g, "<mark>")
    .replace(/\[\[\/highlight\]\]/g, "</mark>");
}
