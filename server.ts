import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync, existsSync } from "fs";
import next from "next";
import { parse } from "url";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Import handlers AFTER app.prepare() so .env vars are loaded
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerHandlers, shutdownAllSessions } = require("./src/socket/handlers") as {
    registerHandlers: (io: Server) => void;
    shutdownAllSessions: () => void;
  };

  const slug = process.env.CLAUDE_BOT_SLUG ?? "";
  const prefix = process.env.CLAUDE_BOT_PATH_PREFIX ?? "c";

  // Use HTTPS if cert files are configured and exist
  const certPath = process.env.SSL_CERT_PATH ?? "";
  const keyPath = process.env.SSL_KEY_PATH ?? "";
  const useHttps = certPath && keyPath && existsSync(certPath) && existsSync(keyPath);

  // Widget bootstrap — served outside basePath so the URL contains no slug.
  // Auth is checked by /api/w/init (requires session cookie).
  const widgetBasePath = slug ? `/${prefix}/${slug}` : "";

  // Bot origin: the scheme+host+port where this server is directly reachable.
  // Stripped of the slug path so it's just the origin (e.g. https://1.2.3.4:3000).
  const botOrigin = (() => {
    try {
      const u = new URL(process.env.NEXTAUTH_URL ?? "");
      return u.origin; // scheme + host + port
    } catch { return ""; }
  })();

  // Widget loader template — __BOT_ORIGIN__ is replaced at serve time so the
  // script always talks to the bot server even when embedded on a different origin.
  const WIDGET_LOADER_TEMPLATE = `(function(){if(window.__claudeWidget)return;window.__claudeWidget=true;var o="__BOT_ORIGIN__";fetch(o+"/api/w/init",{credentials:"include"}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(d){boot(o,d.bp,d.n)}).catch(function(){});function boot(o,bp,name){var b=document.createElement("button");b.title="Chat with "+name;b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';Object.assign(b.style,{position:"fixed",bottom:"24px",right:"24px",zIndex:"2147483647",width:"56px",height:"56px",borderRadius:"50%",background:"#6366f1",color:"#fff",border:"none",cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center",transition:"transform .15s",fontFamily:"system-ui,sans-serif"});b.onmouseenter=function(){b.style.transform="scale(1.1)"};b.onmouseleave=function(){b.style.transform="scale(1)"};var p=document.createElement("div");Object.assign(p.style,{position:"fixed",bottom:"88px",right:"24px",zIndex:"2147483646",width:"840px",height:"600px",maxHeight:"80vh",maxWidth:"calc(100vw - 48px)",borderRadius:"12px",overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.4)",display:"none",border:"1px solid rgba(255,255,255,0.1)"});var f=document.createElement("iframe");f.src=o+bp+"/widget";f.style.cssText="width:100%;height:100%;border:none;background:#1a1a2e";f.allow="clipboard-write";p.appendChild(f);document.body.appendChild(p);var open=false;b.onclick=function(){open=!open;p.style.display=open?"block":"none";b.innerHTML=open?'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>':'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'};document.body.appendChild(b)}})();`;

  // /api/w/init — returns widget config if authenticated (session cookie checked via NextAuth JWT)
  const { getToken } = require("next-auth/jwt") as typeof import("next-auth/jwt");
  const widgetSecret = process.env.NEXTAUTH_SECRET ?? "";
  const widgetCookieName = (process.env.NEXTAUTH_URL ?? "").startsWith("https")
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";

  const handler = (req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
    if (useHttps && !req.headers["x-forwarded-proto"]) {
      req.headers["x-forwarded-proto"] = "https";
    }

    const url = req.url ?? "/";

    // Widget loader script — public, contains no secrets.
    // Bot origin is baked in so the script works from any embedding page.
    if (url === "/api/w.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      res.end(WIDGET_LOADER_TEMPLATE.replace("__BOT_ORIGIN__", botOrigin));
      return;
    }

    // Widget init — returns config only for authenticated users.
    // CORS reflects the requesting origin because auth (session cookie) is the
    // security boundary, not the origin check. This allows cross-origin pages
    // (e.g. user-built pages on port 80) to call this endpoint.
    if (url === "/api/w/init") {
      const origin = req.headers.origin ?? "";
      const corsHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      };
      if (origin) {
        corsHeaders["Access-Control-Allow-Origin"] = origin;
        corsHeaders["Access-Control-Allow-Credentials"] = "true";
      }

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        corsHeaders["Access-Control-Allow-Methods"] = "GET, OPTIONS";
        corsHeaders["Access-Control-Allow-Headers"] = "Content-Type";
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      // Parse cookies into the format getToken expects
      const cookieHeader = req.headers.cookie ?? "";
      const cookies = Object.fromEntries(
        cookieHeader.split(";").map((c) => {
          const [k, ...rest] = c.trim().split("=");
          let v = rest.join("=");
          try { v = decodeURIComponent(v); } catch { /* keep raw */ }
          return [k, v];
        })
      );
      const mockReq = { headers: { cookie: cookieHeader }, cookies } as Parameters<typeof getToken>[0]["req"];

      getToken({ req: mockReq, secret: widgetSecret, cookieName: widgetCookieName, secureCookie: widgetCookieName.startsWith("__Secure-") })
        .then((token: unknown) => {
          if (!token || !(token as Record<string, unknown>).email) {
            res.writeHead(401, corsHeaders);
            res.end(JSON.stringify({ authenticated: false }));
            return;
          }
          let botName = "Octoby";
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const db = require("./src/lib/db").default;
            const row = db.prepare("SELECT name FROM bot_settings WHERE id = 1").get() as { name: string } | undefined;
            if (row?.name) botName = row.name;
          } catch { /* fallback to default */ }
          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify({ authenticated: true, bp: widgetBasePath, n: botName }));
        })
        .catch(() => {
          res.writeHead(401, corsHeaders);
          res.end(JSON.stringify({ authenticated: false }));
        });
      return;
    }

    // Block requests outside basePath from reaching Next.js.
    // The slug URL is a security layer — if you don't know it, you shouldn't
    // be able to discover it. Next.js's default 404 page leaks the slug in
    // asset URLs, so we intercept here and return an opaque 404 instead.
    if (widgetBasePath && !url.startsWith(widgetBasePath + "/") && url !== widgetBasePath) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    handle(req, res, parse(url, true));
  };

  const httpServer = useHttps
    ? createHttpsServer(
        { cert: readFileSync(certPath), key: readFileSync(keyPath) },
        handler
      )
    : createHttpServer(handler);

  const socketPath = slug ? `/${prefix}/${slug}/socket.io` : "/socket.io";

  const io = new Server(httpServer, {
    path: socketPath,
    cors: {
      origin: (incoming: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        if (!incoming || !botOrigin || incoming === botOrigin) cb(null, true);
        else cb(new Error("Origin not allowed"));
      },
      credentials: true,
    },
    maxHttpBufferSize: 1e6,
    pingTimeout: 30000,
    pingInterval: 25000,
    connectTimeout: 15000,
  });

  registerHandlers(io);

  io.engine.on("connection_error", (err: { code: number; message: string; context?: unknown }) => {
    console.warn("[socket] engine connection_error:", err.code, err.message);
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  httpServer.listen(port, () => {
    console.log(`> Ready on port ${port} [${useHttps ? "HTTPS" : "HTTP"}] [${process.env.NODE_ENV}]`);
  });

  // Graceful shutdown: close sessions, flush data, checkpoint WAL, close DB
  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] Received ${signal}, shutting down gracefully...`);

    httpServer.close(() => {
      console.log("[shutdown] HTTP server closed");
    });

    try {
      shutdownAllSessions();
      console.log("[shutdown] All sessions closed, metrics flushed");
    } catch (err) {
      console.error("[shutdown] Error closing sessions:", err);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require("./src/lib/db").default;
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      console.log("[shutdown] Database checkpointed and closed");
    } catch (err) {
      console.error("[shutdown] Error closing database:", err);
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
});
