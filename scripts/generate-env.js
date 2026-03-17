#!/usr/bin/env node
// generate-env.js — Generate .env file with bcrypt-hashed admin password
// Reads config from a JSON file to avoid shell quoting issues with passwords and secrets.
//
// Usage: node scripts/generate-env.js <config.json>
//
// Config JSON shape:
// {
//   "password": "...",
//   "port": "3000",
//   "baseUrl": "https://...",
//   "slug": "...",
//   "secret": "...",
//   "email": "admin@example.com",
//   "projectRoot": "/home/user/project",
//   "installDir": "/home/user/claude-server-bot",
//   "botName": "Octoby",
//   "pathPrefix": "octoby"
// }

const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: node generate-env.js <config.json>");
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (err) {
  console.error("Failed to read config file:", err.message);
  process.exit(1);
}

const required = ["password", "port", "baseUrl", "slug", "secret", "email", "projectRoot", "installDir", "botName", "pathPrefix"];
for (const key of required) {
  if (config[key] === undefined || config[key] === null) {
    console.error(`Missing required config key: ${key}`);
    process.exit(1);
  }
}

// Validate formats to catch injection or misconfiguration early
const portNum = parseInt(config.port, 10);
if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
  console.error(`Invalid port value: ${config.port}`);
  process.exit(1);
}
if (!/^[a-zA-Z0-9_-]+$/.test(config.pathPrefix)) {
  console.error(`Invalid pathPrefix — must be alphanumeric with hyphens/underscores only: ${config.pathPrefix}`);
  process.exit(1);
}
if (!/^[a-zA-Z0-9]+$/.test(config.slug)) {
  console.error(`Invalid slug — must be alphanumeric only: ${config.slug}`);
  process.exit(1);
}
if (config.installDir.includes("..")) {
  console.error(`Invalid installDir — must not contain '..': ${config.installDir}`);
  process.exit(1);
}

const hash = bcrypt.hashSync(config.password, 12);

// Verify the hash immediately to catch bcrypt issues
if (!bcrypt.compareSync(config.password, hash)) {
  console.error("FATAL: bcrypt hash verification failed — hash does not match password");
  process.exit(1);
}

// Escape $ in values to prevent dotenv-expand from treating them as variable refs
function escapeForDotenv(value) {
  return String(value).replace(/\$/g, "\\$");
}

const env = [
  "NODE_ENV=production",
  "PORT=" + config.port,
  "NEXTAUTH_URL=" + config.baseUrl + "/" + config.pathPrefix + "/" + config.slug,
  "NEXTAUTH_SECRET=" + escapeForDotenv(config.secret),
  "CLAUDE_BOT_PATH_PREFIX=" + escapeForDotenv(config.pathPrefix),
  "NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX=" + escapeForDotenv(config.pathPrefix),
  "CLAUDE_BOT_SLUG=" + escapeForDotenv(config.slug),
  "NEXT_PUBLIC_CLAUDE_BOT_SLUG=" + escapeForDotenv(config.slug),
  "CLAUDE_BOT_NAME=" + escapeForDotenv(config.botName),
  "CLAUDE_BOT_ADMIN_EMAIL=" + escapeForDotenv(config.email),
  "CLAUDE_BOT_ADMIN_HASH=" + escapeForDotenv(hash),
  "CLAUDE_PROJECT_ROOT=" + escapeForDotenv(config.projectRoot),
  "DATA_DIR=" + escapeForDotenv(path.join(config.installDir, "data")),
].join("\n") + "\n";

const envPath = path.join(config.installDir, ".env");
fs.writeFileSync(envPath, env, { mode: 0o600 });

// Output verification info to stdout (consumed by install.sh)
console.log(JSON.stringify({ ok: true, hash: hash, envPath: envPath }));
