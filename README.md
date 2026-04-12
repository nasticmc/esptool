# esptool web flasher

A browser-based ESP32 utility that provides:

- Firmware upload and flashing via Web Serial
- Firmware catalog selections from local MeshCore-EastMesh releases
- Full-chip erase button
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

1. **Board**
2. **Firmware**
3. **Version**
4. **Image type** (`Merged full flash` or `Normal app .bin`)

The flash address is auto-filled based on image type:

- `Merged full flash` → `0x0000`
- `Normal app .bin` → `0x10000`

You can still use **Manual firmware file override (.bin)** if needed.

## Usage

1. Serve this folder from a local HTTP server (required for module imports):
   - `python3 -m http.server 8000`
2. Open `http://localhost:8000` in Chrome or Edge.
3. In **Flashing**:
   - Click **Connect Flasher** and choose your board serial port.
   - Select firmware from dropdowns (or use manual file override).
   - Verify flash address.
   - Click **Flash Firmware**.
   - Optional: click **Full Erase Device** for complete flash erase.
4. In **Serial Console**:
   - Click **Connect Serial** and choose the board port.
   - Watch boot/app logs.
   - Enter commands in the input field and click **Send** (or press Enter).
   - Use the helper buttons to insert `set wifi.ssid` and `set wifi.pwd`.

## Notes

- Web Serial is supported in Chromium-based browsers.
- Some boards require pressing `BOOT` / `EN` if auto-reset is unavailable.
