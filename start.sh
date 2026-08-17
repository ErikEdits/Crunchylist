#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Watchlog launcher for Linux / macOS.
# Run:  ./start.sh   (make it executable once with: chmod +x start.sh)
# It installs dependencies on first run, starts the server, and opens a browser.
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Please install it from https://nodejs.org/ and try again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies, this only happens once..."
  npm install --omit=dev
fi

PORT="${PORT:-3000}"
export PORT
URL="http://localhost:${PORT}"
echo "Starting Watchlog on ${URL}"

# Try to open the browser (ignored if no opener is available, e.g. on a server).
( sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
  fi ) &

exec node server/server.js
