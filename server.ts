import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync, existsSync } from "fs";
import { parse } from "url";
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

  const handler = (req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
    handle(req, res, parse(req.url ?? "/", true));
  };

  // Use HTTPS if cert files are configured and exist
  const certPath = process.env.SSL_CERT_PATH ?? "";
  const keyPath = process.env.SSL_KEY_PATH ?? "";
  const useHttps = certPath && keyPath && existsSync(certPath) && existsSync(keyPath);

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
  });

  registerHandlers(io);

  const port = parseInt(process.env.PORT ?? "3000", 10);
  httpServer.listen(port, () => {
    console.log(`> Ready on port ${port} [${useHttps ? "HTTPS" : "HTTP"}] [${process.env.NODE_ENV}]`);
  });
});
