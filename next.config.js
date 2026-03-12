/** @type {import('next').NextConfig} */
const slug = process.env.CLAUDE_BOT_SLUG ?? "";

module.exports = {
  basePath: slug ? `/c/${slug}` : "",
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};
