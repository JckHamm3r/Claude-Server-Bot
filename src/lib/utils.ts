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
