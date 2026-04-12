import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.6.0/bundle.js";

const firmwareInput = document.getElementById("firmware");
const addressGroup = document.getElementById("addressGroup");
const addressInput = document.getElementById("address");
const addressHint = document.getElementById("addressHint");
const flashBtn = document.getElementById("flashBtn");
const eraseBtn = document.getElementById("eraseBtn");
const disconnectFlasherBtn = document.getElementById("disconnectFlasher");
const progressBar = document.getElementById("progress");
const logArea = document.getElementById("log");

const boardSelect = document.getElementById("boardSelect");
const firmwareSelect = document.getElementById("firmwareSelect");
const versionSelect = document.getElementById("versionSelect");
const imageTypeSelect = document.getElementById("imageTypeSelect");
const selectionHint = document.getElementById("selectionHint");

const connectSerialBtn = document.getElementById("connectSerial");
const disconnectSerialBtn = document.getElementById("disconnectSerial");
const clearConsoleBtn = document.getElementById("clearConsole");
const serialInput = document.getElementById("serialInput");
const sendSerialBtn = document.getElementById("sendSerial");
const insertWifiSsidBtn = document.getElementById("insertWifiSsid");
const insertWifiPwdBtn = document.getElementById("insertWifiPwd");
const consoleArea = document.getElementById("console");

let esploader = null;
let transport = null;
let flasherPort = null;

let serialPort = null;
let serialReader = null;
let serialWriter = null;
let serialKeepReading = false;

let firmwareCatalog = null;

const FLASH_BAUD_RATE = 921600;
const SERIAL_BAUD_RATE = 115200;

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

function setSerialConnected(connected) {
  connectSerialBtn.disabled = connected;
  disconnectSerialBtn.disabled = !connected;
  sendSerialBtn.disabled = !connected;
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
    throw new Error("Invalid flash address. Example: 0x10000 or 0x0");
  }
  return value;
}

function setFlasherConnected(connected) {
  disconnectFlasherBtn.disabled = !connected;
}

function setOptions(select, options, preferredValue) {
  const current = preferredValue ?? select.value;
  select.innerHTML = "";

  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }

  if (!options.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No options available";
    select.appendChild(empty);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  if (current && options.some((option) => option.value === current)) {
    select.value = current;
  }
}

function getSelectedImageInfo() {
  if (!firmwareCatalog?.boards) {
    return null;
  }

  const board = firmwareCatalog.boards[boardSelect.value];
  const firmware = board?.firmwares?.[firmwareSelect.value];
  const version = firmware?.versions?.[versionSelect.value];
  const image = version?.images?.[imageTypeSelect.value];

  if (!board || !firmware || !version || !image) {
    return null;
  }

  return {
    boardKey: boardSelect.value,
    boardName: board.display_name,
    firmwareKey: firmwareSelect.value,
    firmwareName: firmware.display_name,
    versionKey: versionSelect.value,
    imageType: imageTypeSelect.value,
    ...image,
  };
}


function toTitleCase(words) {
  return words
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeFirmwareLabel(firmwareKey, displayName = "") {
  const source = `${firmwareKey} ${displayName}`.toLowerCase();
  if (source.includes("repeater") && source.includes("mqtt")) {
    return "Repeater Mqtt";
  }
  if (source.includes("companion") && source.includes("wifi") && source.includes("radio")) {
    return "Companion Wifi Radio";
  }

  const cleaned = (displayName || firmwareKey || "")
    .replace(/[_-]+/g, " ")
    .trim();
  return toTitleCase(cleaned.split(/\s+/));
}

function getVersionLabel(versionKey, version = {}) {
  const candidates = [
    version.eastmesh_version,
    version.meshcore_version,
    version.release_name,
    version.release_tag,
    versionKey,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const match = String(candidate).match(/[vV]\d+(?:\.\d+)+/);
    if (match) {
      return match[0];
    }
  }

  return versionKey;
}

function getImageTypeLabel(typeKey) {
  if (typeKey === "app_bin") {
    return "Update";
  }
  if (typeKey === "merged_full_flash") {
    return "Full Flash";
  }
  return toTitleCase(typeKey.replace(/[_-]+/g, " ").split(/\s+/));
}

function hasManualFirmware() {
  return Boolean(firmwareInput.files?.[0]);
}

function updateSelectionHint() {
  if (hasManualFirmware()) {
    const file = firmwareInput.files[0];
    selectionHint.textContent = `Manual firmware override selected: ${file.name}`;
    return;
  }

  const imageInfo = getSelectedImageInfo();
  if (!imageInfo) {
    selectionHint.textContent = "No manifest-backed firmware selected. Upload a custom .bin firmware to continue.";
    return;
  }

  selectionHint.textContent = `Selected: ${imageInfo.boardName} / ${normalizeFirmwareLabel(imageInfo.firmwareKey, imageInfo.firmwareName)} / ${getVersionLabel(imageInfo.versionKey, imageInfo)} / ${getImageTypeLabel(imageInfo.imageType)}`;
}

function updateAddressControl() {
  const imageInfo = getSelectedImageInfo();

  if (hasManualFirmware()) {
    addressGroup.classList.remove("hidden");
    addressInput.disabled = false;
    addressHint.textContent = "Custom firmware uploaded. You can choose the flash address.";
    return;
  }

  addressGroup.classList.add("hidden");
  addressInput.disabled = true;

  if (imageInfo?.address) {
    addressInput.value = imageInfo.address;
    addressHint.textContent = `Using manifest flash address: ${imageInfo.address}`;
  } else {
    addressHint.textContent = "Upload a custom firmware to choose a flash address.";
  }
}

function refreshImageTypes() {
  if (!firmwareCatalog?.boards) {
    setOptions(imageTypeSelect, []);
    updateSelectionHint();
    return;
  }

  const version = firmwareCatalog.boards?.[boardSelect.value]?.firmwares?.[firmwareSelect.value]?.versions?.[versionSelect.value];
  const imageKeys = Object.keys(version?.images ?? {}).sort();
  const imageOptions = imageKeys.map((key) => ({
    value: key,
    label: getImageTypeLabel(key),
  }));

  setOptions(imageTypeSelect, imageOptions);

  const imageInfo = getSelectedImageInfo();
  if (imageInfo?.address && !hasManualFirmware()) {
    addressInput.value = imageInfo.address;
  }

  updateSelectionHint();
  updateAddressControl();
}

function refreshVersions() {
  if (!firmwareCatalog?.boards) {
    setOptions(versionSelect, []);
    refreshImageTypes();
    return;
  }

  const firmware = firmwareCatalog.boards?.[boardSelect.value]?.firmwares?.[firmwareSelect.value];
  const versionKeys = Object.keys(firmware?.versions ?? {}).sort((a, b) => b.localeCompare(a));
  const versionOptions = versionKeys.map((key) => ({
    value: key,
    label: getVersionLabel(key, firmware?.versions?.[key]),
  }));

  setOptions(versionSelect, versionOptions);
  refreshImageTypes();
}

function refreshFirmwares() {
  if (!firmwareCatalog?.boards) {
    setOptions(firmwareSelect, []);
    refreshVersions();
    return;
  }

  const board = firmwareCatalog.boards?.[boardSelect.value];
  const firmwareKeys = Object.keys(board?.firmwares ?? {}).sort();
  const firmwareOptions = firmwareKeys.map((key) => ({
    value: key,
    label: normalizeFirmwareLabel(key, board.firmwares[key].display_name),
  }));

  setOptions(firmwareSelect, firmwareOptions);
  refreshVersions();
}

function populateBoardSelect() {
  if (!firmwareCatalog?.boards) {
    setOptions(boardSelect, []);
    refreshFirmwares();
    return;
  }

  const boardKeys = Object.keys(firmwareCatalog.boards).sort();
  const boardOptions = boardKeys.map((key) => ({
    value: key,
    label: firmwareCatalog.boards[key].display_name,
  }));
  setOptions(boardSelect, boardOptions);
  refreshFirmwares();
}

async function loadFirmwareManifest() {
  try {
    const response = await fetch("./firmwares/manifest.json", { cache: "reload" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    firmwareCatalog = await response.json();
    appendLog(`Loaded firmware manifest for ${Object.keys(firmwareCatalog.boards ?? {}).length} boards.`);
  } catch (error) {
    firmwareCatalog = null;
    appendLog(`Manifest unavailable (${error.message ?? error}). Manual file upload remains available.`);
  }

  populateBoardSelect();
}

boardSelect.addEventListener("change", refreshFirmwares);
firmwareSelect.addEventListener("change", refreshVersions);
versionSelect.addEventListener("change", refreshImageTypes);
imageTypeSelect.addEventListener("change", refreshImageTypes);
firmwareInput.addEventListener("change", () => {
  updateSelectionHint();
  updateAddressControl();
});

async function connectFlasherIfNeeded() {
  if (esploader) {
    return;
  }

  try {
    ensureWebSerial();
    flasherPort = await navigator.serial.requestPort();
    transport = new Transport(flasherPort, true);
    esploader = new ESPLoader({
      transport,
      baudrate: FLASH_BAUD_RATE,
      terminal: logger,
      debugLogging: false,
    });

    const chip = await esploader.main();
    appendLog(`Connected to ${chip} at ${FLASH_BAUD_RATE} baud.`);
    setFlasherConnected(true);
  } catch (error) {
    appendLog(`Connect failed: ${error.message ?? error}`);
    await safelyDisconnectFlasher();
    throw error;
  }
}

async function resolveFirmwareToFlash() {
  const manualFile = firmwareInput.files?.[0];
  if (manualFile) {
    const buffer = await manualFile.arrayBuffer();
    return {
      name: manualFile.name,
      bytes: new Uint8Array(buffer),
    };
  }

  const selectedImage = getSelectedImageInfo();
  if (selectedImage) {
    const response = await fetch(`./firmwares/${selectedImage.path}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch selected firmware (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      name: selectedImage.file_name,
      bytes: new Uint8Array(arrayBuffer),
    };
  }

  throw new Error("Select a manifest firmware or choose a manual .bin file first.");
}

flashBtn.addEventListener("click", async () => {
  try {
    await connectFlasherIfNeeded();
    progressBar.value = 0;
    const firmware = await resolveFirmwareToFlash();
    const address = getAddress();

    appendLog(`Flashing ${firmware.name} (${firmware.bytes.byteLength} bytes) at 0x${address.toString(16)}...`);

    await esploader.writeFlash({
      fileArray: [{ data: firmware.bytes, address }],
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
  try {
    await connectFlasherIfNeeded();
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
    await serialPort.open({ baudRate: SERIAL_BAUD_RATE });

    serialKeepReading = true;
    setSerialConnected(true);
    appendConsole(`\n[Serial connected at ${SERIAL_BAUD_RATE} baud]\n`);

    const decoder = new TextDecoderStream();
    serialPort.readable.pipeTo(decoder.writable).catch(() => {});
    serialReader = decoder.readable.getReader();
    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(serialPort.writable).catch(() => {});
    serialWriter = encoder.writable.getWriter();

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

async function sendSerialText(text) {
  if (!serialWriter) {
    appendConsole("\n[Serial not connected]\n");
    return;
  }

  const payload = text.endsWith("\n") ? text : `${text}\n`;
  await serialWriter.write(payload);
  appendConsole(`\n> ${text}\n`);
}

sendSerialBtn.addEventListener("click", async () => {
  const text = serialInput.value.trim();
  if (!text) {
    return;
  }
  try {
    await sendSerialText(text);
  } catch (error) {
    appendConsole(`\n[Serial send failed: ${error.message ?? error}]\n`);
  }
});

serialInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  sendSerialBtn.click();
});

insertWifiSsidBtn.addEventListener("click", () => {
  serialInput.value = "set wifi.ssid ";
  serialInput.focus();
});

insertWifiPwdBtn.addEventListener("click", () => {
  serialInput.value = "set wifi.pwd ";
  serialInput.focus();
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

  if (serialWriter) {
    try {
      await serialWriter.close();
      serialWriter.releaseLock();
    } catch {
      // Ignore cleanup errors.
    }
  }
  serialWriter = null;

  if (serialPort) {
    try {
      await serialPort.close();
    } catch {
      // Ignore cleanup errors.
    }
  }
  serialPort = null;

  setSerialConnected(false);
}

loadFirmwareManifest();
