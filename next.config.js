/** @type {import('next').NextConfig} */
const slug = process.env.CLAUDE_BOT_SLUG ?? "";
const prefix = process.env.CLAUDE_BOT_PATH_PREFIX ?? "c";

module.exports = {
  basePath: slug ? `/${prefix}/${slug}` : "",
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
  async headers() {
    return [
      {
        source: "/widget",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        source: "/((?!widget).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};
