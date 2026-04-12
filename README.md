# esptool web flasher

A simple browser-based ESP32 utility that provides:

- Firmware upload and flashing via Web Serial
- Full-chip erase button
- Serial console for post-flash monitoring

## Usage

1. Serve this folder from a local HTTP server (required for module imports):
   - `python3 -m http.server 8000`
2. Open `http://localhost:8000` in Chrome or Edge.
3. In **Flashing**:
   - Click **Connect Flasher** and choose your board serial port.
   - Pick a `.bin` firmware file.
   - Keep address `0x1000` (or change if your image needs another offset).
   - Click **Flash Firmware**.
   - Optional: click **Full Erase Device** for complete flash erase.
4. In **Serial Console**:
   - Click **Connect Serial** and choose the board port.
   - Watch boot/app logs.

## Notes

- Web Serial is supported in Chromium-based browsers.
- Some boards require pressing `BOOT` / `EN` if auto-reset is unavailable.
