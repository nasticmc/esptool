# EastMesh ESP32 Flasher

A browser-based ESP32 utility that provides:

- Firmware flashing via Web Serial with auto-connect
- Firmware catalog from local [MeshCore-EastMesh](https://github.com/xJARiD/MeshCore-EastMesh/releases) releases
- Firmware download for offline use
- Full-chip erase
- Two-way serial console for post-flash monitoring and command entry

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
4. In **Serial Terminal**:
   - Click **Open Repeater Config** to launch the MeshCore configuration portal.
   - Click **Connect Serial** and choose the board port.
   - Watch boot/app logs in the console area.
   - Enter commands in the input field and click **Send** (or press Enter).
   - Click **Clear Console** to reset the console output.
   - Click **Disconnect Serial** when done.
5. If you select a WiFi firmware, use the **Wifi Configuration** card:
   - Hold the device **USER** button for **8 seconds** to enter CLI mode.
   - Click **set wifi.ssid** and **set wifi.pwd** to pre-fill commands in the serial input field.

## Notes

- Web Serial is supported in Chromium-based browsers only (Chrome, Edge, Opera).
- HTTPS or localhost is required — the app will not work from `file://` URLs.
- Some boards require pressing `BOOT` / `EN` if auto-reset is unavailable.
