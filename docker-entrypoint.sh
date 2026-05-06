#!/bin/sh
set -e

# Run an initial sync immediately on startup
if ! python3 /app/sync_meshcore_releases.py; then
    echo "Initial firmware sync failed; continuing to start web server."
fi

# Run the sync every hour in the background
(while true; do
    sleep 3600
    if ! python3 /app/sync_meshcore_releases.py; then
        echo "Background firmware sync failed; will retry in one hour."
    fi
done) &

# Serve the web UI
exec python3 /app/server.py
