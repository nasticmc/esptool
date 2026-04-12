import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.6.0/bundle.js";

const firmwareInput = document.getElementById("firmware");
const addressInput = document.getElementById("address");
const baudSelect = document.getElementById("baud");
const connectFlasherBtn = document.getElementById("connectFlasher");
const flashBtn = document.getElementById("flashBtn");
const eraseBtn = document.getElementById("eraseBtn");
const disconnectFlasherBtn = document.getElementById("disconnectFlasher");
const progressBar = document.getElementById("progress");
const logArea = document.getElementById("log");

const connectSerialBtn = document.getElementById("connectSerial");
const disconnectSerialBtn = document.getElementById("disconnectSerial");
const clearConsoleBtn = document.getElementById("clearConsole");
const consoleArea = document.getElementById("console");

let esploader = null;
let transport = null;
let flasherPort = null;

let serialPort = null;
let serialReader = null;
let serialKeepReading = false;

const logger = {
  clean() {
    logArea.value = "";
  },
  writeLine(message) {
    appendLog(message);
  },
  write(message) {
    appendLog(message);
  },
};

function appendLog(message) {
  logArea.value += `${message}\n`;
  logArea.scrollTop = logArea.scrollHeight;
}

function appendConsole(message) {
  consoleArea.value += message;
  consoleArea.scrollTop = consoleArea.scrollHeight;
}

function ensureWebSerial() {
  if (!navigator.serial) {
    throw new Error("Web Serial API not available. Use latest Chrome or Edge.");
  }
}

function getAddress() {
  const raw = addressInput.value.trim().toLowerCase();
  const normalized = raw.startsWith("0x") ? raw.slice(2) : raw;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Invalid flash address. Example: 0x1000");
  }
  return value;
}

function setFlasherConnected(connected) {
  flashBtn.disabled = !connected;
  eraseBtn.disabled = !connected;
  disconnectFlasherBtn.disabled = !connected;
  connectFlasherBtn.disabled = connected;
}

connectFlasherBtn.addEventListener("click", async () => {
  try {
    ensureWebSerial();
    flasherPort = await navigator.serial.requestPort();
    transport = new Transport(flasherPort, true);
    esploader = new ESPLoader({
      transport,
      baudrate: Number(baudSelect.value),
      terminal: logger,
      debugLogging: false,
    });

    const chip = await esploader.main();
    appendLog(`Connected to ${chip}`);
    setFlasherConnected(true);
  } catch (error) {
    appendLog(`Connect failed: ${error.message ?? error}`);
    await safelyDisconnectFlasher();
  }
});

flashBtn.addEventListener("click", async () => {
  const file = firmwareInput.files?.[0];
  if (!file) {
    appendLog("Select a .bin firmware file first.");
    return;
  }
  if (!esploader) {
    appendLog("Connect flasher first.");
    return;
  }

  try {
    progressBar.value = 0;
    const buffer = await file.arrayBuffer();
    const firmware = new Uint8Array(buffer);
    const address = getAddress();

    appendLog(`Flashing ${file.name} (${firmware.byteLength} bytes) at 0x${address.toString(16)}...`);

    await esploader.writeFlash({
      fileArray: [{ data: firmware, address }],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (_fileIndex, written, total) => {
        const pct = total > 0 ? (written / total) * 100 : 0;
        progressBar.value = pct;
      },
    });

    await esploader.after("hard_reset");
    progressBar.value = 100;
    appendLog("Flash complete. Device reset.");
  } catch (error) {
    appendLog(`Flash failed: ${error.message ?? error}`);
  }
});

eraseBtn.addEventListener("click", async () => {
  if (!esploader) {
    appendLog("Connect flasher first.");
    return;
  }

  try {
    progressBar.value = 0;
    appendLog("Starting full chip erase. This may take a while...");
    await esploader.eraseFlash();
    await esploader.after("hard_reset");
    progressBar.value = 100;
    appendLog("Full erase complete.");
  } catch (error) {
    appendLog(`Erase failed: ${error.message ?? error}`);
  }
});

disconnectFlasherBtn.addEventListener("click", async () => {
  await safelyDisconnectFlasher();
  appendLog("Flasher disconnected.");
});

async function safelyDisconnectFlasher() {
  setFlasherConnected(false);
  esploader = null;
  if (transport) {
    try {
      await transport.disconnect();
    } catch {
      // Ignore disconnect errors.
    }
  }
  transport = null;
  flasherPort = null;
}

connectSerialBtn.addEventListener("click", async () => {
  try {
    ensureWebSerial();
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    serialKeepReading = true;
    connectSerialBtn.disabled = true;
    disconnectSerialBtn.disabled = false;
    appendConsole("\n[Serial connected]\n");

    const decoder = new TextDecoderStream();
    serialPort.readable.pipeTo(decoder.writable).catch(() => {});
    serialReader = decoder.readable.getReader();

    while (serialKeepReading) {
      const { value, done } = await serialReader.read();
      if (done) {
        break;
      }
      if (value) {
        appendConsole(value);
      }
    }
  } catch (error) {
    appendConsole(`\n[Serial connect failed: ${error.message ?? error}]\n`);
    await safelyDisconnectSerial();
  }
});

disconnectSerialBtn.addEventListener("click", async () => {
  await safelyDisconnectSerial();
  appendConsole("\n[Serial disconnected]\n");
});

clearConsoleBtn.addEventListener("click", () => {
  consoleArea.value = "";
});

async function safelyDisconnectSerial() {
  serialKeepReading = false;
  if (serialReader) {
    try {
      await serialReader.cancel();
      serialReader.releaseLock();
    } catch {
      // Ignore cleanup errors.
    }
  }
  serialReader = null;

  if (serialPort) {
    try {
      await serialPort.close();
    } catch {
      // Ignore cleanup errors.
    }
  }
  serialPort = null;

  connectSerialBtn.disabled = false;
  disconnectSerialBtn.disabled = true;
}
