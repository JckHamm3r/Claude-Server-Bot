import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
  const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
  const basePath = slug ? `/${prefix}/${slug}` : "";

  // Always allow these paths (public or static assets)
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname === "/favicon.ico" ||
    pathname === "/claude-code.png" ||
    pathname.startsWith("/avatars/") ||
    pathname === "/api/bot-identity" ||
    pathname === "/api/health/ping" ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico")
  ) {
    return NextResponse.next();
  }

  // Use NEXTAUTH_URL for redirects to avoid localhost in callback URLs
  // (request.nextUrl.origin resolves to localhost on custom servers)
  const configuredUrl = process.env.NEXTAUTH_URL ?? "";
  const origin = configuredUrl
    ? configuredUrl.replace(new RegExp(`(/${prefix}/${slug})?$`), "")
    : request.nextUrl.origin;

  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      // Not authenticated → redirect to login (include basePath)
      const loginUrl = new URL(`${basePath}/login`, origin);
      loginUrl.searchParams.set("callbackUrl", `${origin}${basePath}${pathname}`);
      return NextResponse.redirect(loginUrl);
    }

    // Authenticated: allow /login and /setup through
    if (pathname === "/login" || pathname === "/setup") {
      return NextResponse.next();
    }

    // Check setup_complete for dashboard routes
    // We store setup_complete in a cookie to avoid DB lookups in middleware (edge runtime)
    const setupComplete = request.cookies.get("bot_setup_complete")?.value === "1";
    if (!setupComplete && pathname !== "/setup" && !pathname.startsWith("/api/settings/project") && !pathname.startsWith("/api/claude-code/test") && !pathname.startsWith("/api/setup/")) {
      const setupUrl = new URL(`${basePath}/setup`, origin);
      return NextResponse.redirect(setupUrl);
    }

  } catch {
    const loginUrl = new URL(`${basePath}/login`, origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico|claude-code.png|api/auth).*)",
  ],
};
