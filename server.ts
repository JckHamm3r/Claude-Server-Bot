import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync, existsSync } from "fs";
import next from "next";
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
    // Tell Next.js the real protocol so redirects use https:// not http:/
    if (useHttps && !req.headers["x-forwarded-proto"]) {
      req.headers["x-forwarded-proto"] = "https";
    }

    const url = new URL(req.url ?? "/", `${scheme}://${req.headers.host || "localhost"}`);
    const parsedUrl = {
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
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
