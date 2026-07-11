#!/usr/bin/env bash
# One-time setup for browser verification without root: a local venv with
# Playwright, Chromium, and the missing system libs extracted from debs into
# a gitignored cache. Idempotent - safe to re-run; finished steps are skipped.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p .cache

VENV=.cache/venv
LIBS=.cache/locallibs
DEBS=.cache/debs

if [ ! -x "$VENV/bin/python" ]; then
    echo "Creating venv..."
    python3 -m venv "$VENV"
fi

if ! "$VENV/bin/python" -c 'import playwright' >/dev/null 2>&1; then
    echo "Installing playwright..."
    "$VENV/bin/pip" -q install playwright
fi

echo "Ensuring Chromium is installed (skips if cached)..."
"$VENV/bin/python" -m playwright install chromium

if [ ! -d "$LIBS/usr/lib/x86_64-linux-gnu" ]; then
    echo "Extracting Chromium system libs (no root needed)..."
    mkdir -p "$LIBS" "$DEBS"
    (cd "$DEBS" && apt-get download \
        libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 \
        libatspi2.0-0t64 libxdamage1 libxres1)
    for deb in "$DEBS"/*.deb; do
        dpkg-deb -x "$deb" "$LIBS"
    done
fi

echo
echo "Setup complete. Drivers set LD_LIBRARY_PATH themselves; run e.g.:"
echo "  $PWD/$VENV/bin/python $PWD/autoplay_arena.py"
