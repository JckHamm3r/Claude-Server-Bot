#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Pulling latest..."
git pull

echo "Installing dependencies..."
pnpm install --silent

echo "Building..."
# Load slug from .env so basePath is correct
if [ -f .env ]; then
  export $(grep -E '^CLAUDE_BOT_SLUG=' .env | xargs)
fi
pnpm build

echo "Restarting service..."
sudo systemctl restart claude-bot.service

echo "✓ Updated and restarted."
