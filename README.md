# EastMesh ESP32 Flasher

A browser-based ESP32 utility that provides:

- Firmware flashing via Web Serial with auto-connect
- Firmware catalog from local [MeshCore-EastMesh](https://github.com/xJARiD/MeshCore-EastMesh/releases) releases
- Firmware download for offline use
- Full-chip erase

## Syncing MeshCore-EastMesh releases locally

Use the included script to pull all release `.bin` files from
[`xJARiD/MeshCore-EastMesh`](https://github.com/xJARiD/MeshCore-EastMesh/releases) and
write/update a local manifest.

```bash
python3 sync_meshcore_releases.py
```

This will:

- Download missing firmware files into `firmwares/<board>/<firmware>/<version>/...`
- Skip files that are already present
- Build/update `firmwares/manifest.json` for the web UI
- Refresh `firmwares/release-notes.yml` from MeshCore-EastMesh

To refresh only the manifest (without downloading binaries):

```bash
python3 sync_meshcore_releases.py --manifest-only
```

## Web UI firmware selection

When `firmwares/manifest.json` exists, the flasher loads these dependent selectors:

1. **Firmware** — choose the firmware type (e.g., Repeater Mqtt)
2. **Board** — filters to boards that support the selected firmware
3. **Version** — available versions for that board + firmware combination
4. **Image type** — `Full Flash` (merged, address `0x0000`) or `Update` (app, address `0x10000`)

The flash address is determined automatically from the selected image type.


## Run as a Linux service (systemd)

Yes — this project can run cleanly as a service. Sample units are provided in
`deploy/systemd/`:

- `esptool-web.service` — serves the web UI with `python3 -m http.server`
- `esptool-sync.service` — one-shot job to run `sync_meshcore_releases.py`
- `esptool-sync.timer` — triggers sync service every hour

### 1) Create a service account and install files

```bash
sudo useradd --system --home /opt/esptool --shell /usr/sbin/nologin esptool
sudo mkdir -p /opt/esptool
sudo rsync -a --delete ./ /opt/esptool/
sudo chown -R esptool:esptool /opt/esptool
```

### 2) Install and start the web service

```bash
sudo cp deploy/systemd/esptool-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now esptool-web.service
```

Optional runtime overrides (port/bind) can be placed in `/etc/default/esptool`:

```bash
ESPTOOL_PORT=8000
ESPTOOL_BIND=0.0.0.0
```

### 3) Enable hourly firmware sync (secondary service + timer)

```bash
sudo cp deploy/systemd/esptool-sync.service /etc/systemd/system/
sudo cp deploy/systemd/esptool-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now esptool-sync.timer
```

Check status:

```bash
systemctl status esptool-web.service
systemctl list-timers esptool-sync.timer
```

### Alternate approach: run sync as part of web service startup

If you prefer a single service, add this to `esptool-web.service`:

```ini
ExecStartPre=/usr/bin/python3 /opt/esptool/sync_meshcore_releases.py
```

That runs sync before each web-service start/restart, but does **not** provide
hourly updates while the service is running. For hourly refresh, keep the timer.

## Usage

1. Serve this folder from a local HTTP server (required for module imports):
   ```bash
   python3 -m http.server 8000
   ```
2. Open `http://localhost:8000` in Chrome or Edge.
3. In **Flashing**:
   - Select firmware, board, version, and image type from the dropdowns.
   - Click **Flash Firmware** — the flasher auto-connects to your board's serial port on first use.
   - The progress bar and log area show flashing status; the flasher auto-disconnects when done.
   - Click **Download Selected Firmware** to save the `.bin` file locally.
   - Click **Full Erase Device** to perform a complete flash erase.
4. Review release notes for the selected firmware version in the **Release Notes** panel.

## Notes

- Web Serial is supported in Chromium-based browsers only (Chrome, Edge, Opera).
- HTTPS or localhost is required — the app will not work from `file://` URLs.
- Some boards require pressing `BOOT` / `EN` if auto-reset is unavailable.
