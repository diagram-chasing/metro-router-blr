#!/usr/bin/env bash
# Launch the exhibition wall fullscreen on a macOS box (Google Chrome --kiosk).
# Assumes the node server is already running (`node build` / launchd) on $WALL_URL.
# Keeps the Mac awake for the duration via caffeinate. See INSTALL.md §4.
set -euo pipefail

WALL_URL="${WALL_URL:-http://localhost:3000/?scale=1}"
PROFILE="${WALL_PROFILE:-$HOME/Library/Application Support/wall-chrome}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [ ! -x "$CHROME" ]; then
	echo "Google Chrome not found at $CHROME (set \$CHROME)" >&2
	exit 1
fi

# Prevent display/system sleep while the wall is up; clean up on exit.
caffeinate -dimsu &
CAF=$!
trap 'kill "$CAF" 2>/dev/null || true' EXIT

exec "$CHROME" \
	--kiosk \
	--app="$WALL_URL" \
	--user-data-dir="$PROFILE" \
	--noerrdialogs \
	--disable-session-crashed-bubble \
	--disable-infobars \
	--overscroll-history-navigation=0 \
	--check-for-update-interval=31536000 \
	--autoplay-policy=no-user-gesture-required
