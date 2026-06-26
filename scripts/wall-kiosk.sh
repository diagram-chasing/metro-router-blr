#!/usr/bin/env bash
# Launch the exhibition wall fullscreen on a Linux kiosk box (Chromium).
# Assumes the node server is already running (systemd service / `node build`) on $WALL_URL.
# See INSTALL.md for the systemd-user unit that autostarts + restarts this on boot.
set -euo pipefail

WALL_URL="${WALL_URL:-http://localhost:3000/?scale=1}"
PROFILE="${WALL_PROFILE:-$HOME/.config/wall-chromium}"

# Keep the screen awake — no blanking, no DPMS, no screensaver.
if command -v xset >/dev/null 2>&1; then
	xset s off || true
	xset s noblank || true
	xset -dpms || true
fi
# Hide the pointer when idle (belt-and-suspenders with the in-app cursor:none).
command -v unclutter >/dev/null 2>&1 && (unclutter -idle 1 &) || true

# Prefer chromium, fall back to google-chrome.
BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
if [ -z "$BROWSER" ]; then
	echo "No chromium/chrome found on PATH" >&2
	exit 1
fi

exec "$BROWSER" \
	--kiosk \
	--app="$WALL_URL" \
	--user-data-dir="$PROFILE" \
	--noerrdialogs \
	--disable-session-crashed-bubble \
	--disable-infobars \
	--disable-pinch \
	--overscroll-history-navigation=0 \
	--check-for-update-interval=31536000 \
	--autoplay-policy=no-user-gesture-required \
	--start-fullscreen
