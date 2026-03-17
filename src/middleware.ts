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
    pathname === "/change-password" ||
    pathname === "/favicon.ico" ||
    pathname === "/claude-code.png" ||
    pathname.startsWith("/avatars/") ||
    pathname === "/api/bot-identity" ||
    pathname === "/api/health/ping" ||
    pathname === "/api/users/password/force-change" ||
    pathname.includes("/api/internal/sub-agent")
  ) {
    return NextResponse.next();
  }

  // Use NEXTAUTH_URL for redirects to avoid localhost in callback URLs
  // (request.nextUrl.origin resolves to localhost on custom servers)
  const configuredUrl = process.env.NEXTAUTH_URL ?? "";
  const suffix = `/${prefix}/${slug}`;
  const origin = configuredUrl
    ? (configuredUrl.endsWith(suffix) ? configuredUrl.slice(0, -suffix.length) : configuredUrl)
    : request.nextUrl.origin;

  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      // Not authenticated → redirect to login (include basePath)
      const loginUrl = new URL(`${basePath}/login`, origin);
      const safePath = pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/";
      loginUrl.searchParams.set("callbackUrl", `${origin}${basePath}${safePath}`);
      return NextResponse.redirect(loginUrl);
    }

    // Check if user must change password (flag is stored in the JWT token)
    if (token.mustChangePassword && pathname !== "/change-password") {
      const changePasswordUrl = new URL(`${basePath}/change-password`, origin);
      return NextResponse.redirect(changePasswordUrl);
    }

    // Authenticated: allow /login and /setup through
    if (pathname === "/login" || pathname === "/setup") {
      return NextResponse.next();
    }

    // Only the admin owner needs to complete setup. Non-admin users skip the
    // wizard entirely and go straight to the dashboard.
    const isAdmin = token.isAdmin === true;
    const setupComplete = token.setupComplete === true ||
      request.cookies.get("bot_setup_complete")?.value === "1";
    if (
      isAdmin &&
      !setupComplete &&
      pathname !== "/setup" &&
      !pathname.startsWith("/api/settings/project") &&
      !pathname.startsWith("/api/claude-code/test") &&
      !pathname.startsWith("/api/setup/") &&
      !pathname.startsWith("/api/app-settings") &&
      !pathname.startsWith("/api/users/profile")
    ) {
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
