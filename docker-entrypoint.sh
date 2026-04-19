#!/bin/sh
set -e

# Run an initial sync immediately on startup
python3 /app/sync_meshcore_releases.py

# Run the sync every hour in the background
(while true; do
    sleep 3600
    python3 /app/sync_meshcore_releases.py
done) &

# Serve the web UI
exec python3 -m http.server "${ESPTOOL_PORT:-8000}" --bind "${ESPTOOL_BIND:-0.0.0.0}"
