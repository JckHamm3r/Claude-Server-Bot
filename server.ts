import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync, existsSync } from "fs";
import next from "next";
import type { UrlWithParsedQuery } from "url";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Import handlers AFTER app.prepare() so .env vars are loaded
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerHandlers } = require("./src/socket/handlers") as {
    registerHandlers: (io: Server) => void;
  };

  // Use HTTPS if cert files are configured and exist
  const certPath = process.env.SSL_CERT_PATH ?? "";
  const keyPath = process.env.SSL_KEY_PATH ?? "";
  const useHttps = certPath && keyPath && existsSync(certPath) && existsSync(keyPath);
  const scheme = useHttps ? "https" : "http";

  const handler = (req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
    const url = new URL(req.url ?? "/", `${scheme}://${req.headers.host || "localhost"}`);
    const query: Record<string, string | string[]> = {};
    for (const [key, value] of url.searchParams.entries()) {
      const existing = query[key];
      if (existing !== undefined) {
        query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        query[key] = value;
      }
    }
    const parsedUrl: UrlWithParsedQuery = {
      protocol: url.protocol,
      slashes: true,
      auth: null,
      host: url.host,
      port: url.port,
      hostname: url.hostname,
      hash: url.hash || null,
      search: url.search || null,
      query,
      pathname: url.pathname,
      path: url.pathname + (url.search || ""),
      href: url.href,
    };
    handle(req, res, parsedUrl);
  };

  const httpServer = useHttps
    ? createHttpsServer(
        { cert: readFileSync(certPath), key: readFileSync(keyPath) },
        handler
      )
    : createHttpServer(handler);

  const slug = process.env.CLAUDE_BOT_SLUG ?? "";
  const prefix = process.env.CLAUDE_BOT_PATH_PREFIX ?? "c";
  const socketPath = slug ? `/${prefix}/${slug}/socket.io` : "/socket.io";

  const io = new Server(httpServer, {
    path: socketPath,
    cors: { origin: false },
    maxHttpBufferSize: 1e6,
  });

  registerHandlers(io);

  const port = parseInt(process.env.PORT ?? "3000", 10);
  httpServer.listen(port, () => {
    console.log(`> Ready on port ${port} [${useHttps ? "HTTPS" : "HTTP"}] [${process.env.NODE_ENV}]`);
  });
});
