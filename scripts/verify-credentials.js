#!/usr/bin/env node
// verify-credentials.js — Verify that admin credentials in .env are valid
// Usage: echo "<password>" | node scripts/verify-credentials.js <env-file>

const bcrypt = require("bcryptjs");
const fs = require("fs");

const envFile = process.argv[2];

if (!envFile) {
  console.error("Usage: echo '<password>' | node verify-credentials.js <env-file>");
  process.exit(1);
}

// Read password from stdin using process.stdin (portable; /dev/stdin may not exist in all environments)
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

function getEnvValue(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp("^" + escapedKey + "=(.*)$", "m"));
  if (!match) return null;
  return match[1].replace(/\\\$/g, "$");
}

(async () => {
  const password = await readStdin().catch(() => "");
  if (!password) {
    console.error("No password provided on stdin");
    process.exit(1);
  }

  let envContent;
  try {
    envContent = fs.readFileSync(envFile, "utf8");
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: "Cannot read .env: " + err.message }));
    process.exit(1);
  }

  const email = getEnvValue(envContent, "CLAUDE_BOT_ADMIN_EMAIL");
  const hash = getEnvValue(envContent, "CLAUDE_BOT_ADMIN_HASH");

  if (!email) {
    console.error(JSON.stringify({ ok: false, error: "CLAUDE_BOT_ADMIN_EMAIL not found in .env" }));
    process.exit(1);
  }

  if (!hash) {
    console.error(JSON.stringify({ ok: false, error: "CLAUDE_BOT_ADMIN_HASH not found in .env" }));
    process.exit(1);
  }

  if (!hash.startsWith("$2a$") && !hash.startsWith("$2b$") && !hash.startsWith("$2y$")) {
    console.error(JSON.stringify({ ok: false, error: "CLAUDE_BOT_ADMIN_HASH does not look like a bcrypt hash" }));
    process.exit(1);
  }

  const matches = bcrypt.compareSync(password, hash);
  if (matches) {
    console.log(JSON.stringify({ ok: true, email: email }));
  } else {
    console.error(JSON.stringify({ ok: false, error: "Password does not match hash in .env" }));
    process.exit(1);
  }
})();
