import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow these paths (public or static assets)
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/claude-code.png" ||
    pathname === "/api/bot-identity" ||
    pathname === "/api/health/ping" ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico")
  ) {
    return NextResponse.next();
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? request.nextUrl.origin;

  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      // Not authenticated → redirect to login
      const loginUrl = new URL("/login", baseUrl);
      loginUrl.searchParams.set("callbackUrl", `${baseUrl}${pathname}`);
      return NextResponse.redirect(loginUrl);
    }

    // Authenticated: allow /login and /setup through
    if (pathname === "/login" || pathname === "/setup") {
      return NextResponse.next();
    }

    // Check setup_complete for dashboard routes
    // We store setup_complete in a cookie to avoid DB lookups in middleware (edge runtime)
    const setupComplete = request.cookies.get("bot_setup_complete")?.value === "1";
    if (!setupComplete && pathname !== "/setup") {
      const setupUrl = new URL("/setup", baseUrl);
      return NextResponse.redirect(setupUrl);
    }

  } catch {
    const loginUrl = new URL("/login", baseUrl);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|claude-code.png|api/auth).*)",
  ],
};
