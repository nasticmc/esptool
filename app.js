import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.6.0/bundle.js";

const flashBtn = document.getElementById("flashBtn");
const downloadFirmwareBtn = document.getElementById("downloadFirmwareBtn");
const eraseBtn = document.getElementById("eraseBtn");
const progressBar = document.getElementById("progress");
const logArea = document.getElementById("log");

const boardSelect = document.getElementById("boardSelect");
const firmwareSelect = document.getElementById("firmwareSelect");
const versionSelect = document.getElementById("versionSelect");
const imageTypeSelect = document.getElementById("imageTypeSelect");
const releaseNotesSection = document.getElementById("releaseNotesSection");
const releaseNotesMeta = document.getElementById("releaseNotesMeta");
const releaseNotesSummary = document.getElementById("releaseNotesSummary");
const releaseNotesChanges = document.getElementById("releaseNotesChanges");
const releaseNotesBreakingHeading = document.getElementById("releaseNotesBreakingHeading");
const releaseNotesBreakingChanges = document.getElementById("releaseNotesBreakingChanges");

const connectSerialBtn = document.getElementById("connectSerial");
const disconnectSerialBtn = document.getElementById("disconnectSerial");
const clearConsoleBtn = document.getElementById("clearConsole");
const serialInput = document.getElementById("serialInput");
const sendSerialBtn = document.getElementById("sendSerial");
const wifiConfigSection = document.getElementById("wifiConfigSection");
const repeaterConfigSection = document.getElementById("repeaterConfigSection");
const quickSetWifiSsidBtn = document.getElementById("quickSetWifiSsid");
const quickSetWifiPwdBtn = document.getElementById("quickSetWifiPwd");
const quickSetRepeaterWifiSsidBtn = document.getElementById("quickSetRepeaterWifiSsid");
const quickSetRepeaterWifiPwdBtn = document.getElementById("quickSetRepeaterWifiPwd");
const quickSetWebOnBtn = document.getElementById("quickSetWebOn");
const quickSetWebOffBtn = document.getElementById("quickSetWebOff");
const quickGetWebStatusBtn = document.getElementById("quickGetWebStatus");
const quickGetWifiStatusBtn = document.getElementById("quickGetWifiStatus");
const consoleArea = document.getElementById("console");

let esploader = null;
let transport = null;
let flasherPort = null;

let serialPort = null;
let serialReader = null;
let serialWriter = null;
let serialKeepReading = false;

let firmwareCatalog = null;
let releaseNotesCatalog = null;

const FLASH_BAUD_RATE = 921600;
const SERIAL_BAUD_RATE = 115200;
const RELEASE_NOTES_URL = "https://raw.githubusercontent.com/xJARiD/MeshCore-EastMesh/refs/heads/main/release-notes.yml";

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
  const imageInfo = getSelectedImageInfo();
  const raw = String(imageInfo?.address ?? "0x10000").trim().toLowerCase();
  const normalized = raw.startsWith("0x") ? raw.slice(2) : raw;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid manifest flash address: ${imageInfo?.address ?? raw}`);
  }
  return value;
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

  const selectedFirmwareKey = getFirmwareKeyForBoard(boardSelect.value, firmwareSelect.value);
  const board = firmwareCatalog.boards[boardSelect.value];
  const firmware = board?.firmwares?.[selectedFirmwareKey];
  const version = firmware?.versions?.[versionSelect.value];
  const image = version?.images?.[imageTypeSelect.value];

  if (!board || !firmware || !version || !image) {
    return null;
  }

  return {
    boardKey: boardSelect.value,
    boardName: board.display_name,
    firmwareKey: selectedFirmwareKey,
    firmwareName: firmware.display_name,
    versionKey: versionSelect.value,
    imageType: imageTypeSelect.value,
    ...image,
  };
}

function normalizeFirmwareId(value = "") {
  return String(value).trim().toLowerCase();
}

function getSelectedFirmwareMetadata() {
  const selectedBoardKey = boardSelect.value;
  const selectedFirmwareId = normalizeFirmwareId(firmwareSelect.value);
  const boardFirmwares = firmwareCatalog?.boards?.[selectedBoardKey]?.firmwares;

  if (boardFirmwares) {
    const matchingEntry = Object.entries(boardFirmwares).find(([firmwareKey]) => normalizeFirmwareId(firmwareKey) === selectedFirmwareId);
    if (matchingEntry) {
      const [firmwareKey, firmware] = matchingEntry;
      return {
        key: firmwareKey,
        displayName: firmware?.display_name ?? "",
      };
    }
  }

  const selectedLabel = String(firmwareSelect.options[firmwareSelect.selectedIndex]?.textContent ?? "");
  return {
    key: selectedFirmwareId,
    displayName: selectedLabel,
  };
}

function selectedFirmwareSupportsWifi() {
  const firmware = getSelectedFirmwareMetadata();
  const source = `${firmware.key} ${firmware.displayName}`.toLowerCase();
  return source.includes("wifi");
}

function selectedFirmwareIsRepeater() {
  const firmware = getSelectedFirmwareMetadata();
  const source = `${firmware.key} ${firmware.displayName}`.toLowerCase();
  return source.includes("repeater");
}

function updateContextualSections() {
  const showRepeaterConfig = selectedFirmwareIsRepeater();
  const showWifiConfig = selectedFirmwareSupportsWifi();

  if (showWifiConfig) {
    wifiConfigSection.classList.remove("hidden");
  } else {
    wifiConfigSection.classList.add("hidden");
  }

  if (showRepeaterConfig) {
    repeaterConfigSection.classList.remove("hidden");
  } else {
    repeaterConfigSection.classList.add("hidden");
  }
}

function getFirmwareKeyForBoard(boardKey, firmwareId) {
  const firmwares = firmwareCatalog?.boards?.[boardKey]?.firmwares;
  if (!firmwares) {
    return null;
  }

  const normalizedId = normalizeFirmwareId(firmwareId);
  return Object.keys(firmwares).find((firmwareKey) => normalizeFirmwareId(firmwareKey) === normalizedId) ?? null;
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

function getVersionLabel(versionKey, version = {}, firmwareKey = "") {
  const candidates = [
    version.eastmesh_version,
    version.meshcore_version,
    version.release_name,
    version.release_tag,
    versionKey,
  ].filter(Boolean);

  const isRepeaterFirmware = String(firmwareKey || "").toLowerCase().includes("repeater");
  if (isRepeaterFirmware) {
    for (const candidate of candidates) {
      const combinedMatch = String(candidate).match(/[vV]\d+(?:\.\d+)+-eastmesh-[vV]\d+(?:\.\d+)+/);
      if (combinedMatch) {
        return combinedMatch[0].toLowerCase();
      }
    }
  }

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

function stripOptionalQuotes(value = "") {
  const trimmed = String(value).trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleReleaseNotesYaml(yamlText) {
  const lines = String(yamlText).split(/\r?\n/);
  const releases = [];
  let currentRelease = null;
  let currentChange = null;
  let inChanges = false;
  let inBreakingChanges = false;

  for (const line of lines) {
    const versionMatch = line.match(/^  - version:\s*(.+)\s*$/);
    if (versionMatch) {
      if (currentRelease) {
        releases.push(currentRelease);
      }
      currentRelease = {
        version: stripOptionalQuotes(versionMatch[1]),
        tag: "",
        date: "",
        summary: "",
        changes: [],
        breakingChanges: [],
      };
      currentChange = null;
      inChanges = false;
      inBreakingChanges = false;
      continue;
    }

    if (!currentRelease) {
      continue;
    }

    const topLevelInRelease = line.match(/^    ([a-z_]+):\s*(.*)\s*$/);
    if (topLevelInRelease) {
      const [, key, rawValue] = topLevelInRelease;
      if (key === "changes") {
        inChanges = true;
        inBreakingChanges = false;
        currentChange = null;
        continue;
      }
      if (key === "breaking_changes") {
        inChanges = false;
        inBreakingChanges = true;
        currentChange = null;
        if (rawValue === "[]") {
          inBreakingChanges = false;
        }
        continue;
      }
      inChanges = false;
      inBreakingChanges = false;
      currentChange = null;
      if (key === "tag" || key === "date" || key === "summary") {
        currentRelease[key] = stripOptionalQuotes(rawValue);
      }
      continue;
    }

    if (inChanges) {
      const changeTypeMatch = line.match(/^      - type:\s*(.+)\s*$/);
      if (changeTypeMatch) {
        currentChange = {
          type: stripOptionalQuotes(changeTypeMatch[1]),
          area: "",
          text: "",
        };
        continue;
      }

      const changeAreaMatch = line.match(/^        area:\s*(.+)\s*$/);
      if (changeAreaMatch && currentChange) {
        currentChange.area = stripOptionalQuotes(changeAreaMatch[1]);
        continue;
      }

      const changeTextMatch = line.match(/^        text:\s*(.+)\s*$/);
      if (changeTextMatch && currentChange) {
        currentChange.text = stripOptionalQuotes(changeTextMatch[1]);
        currentRelease.changes.push(currentChange);
        currentChange = null;
      }
      continue;
    }

    if (inBreakingChanges) {
      const breakingChangeMatch = line.match(/^      -\s*(.+)\s*$/);
      if (breakingChangeMatch) {
        currentRelease.breakingChanges.push(stripOptionalQuotes(breakingChangeMatch[1]));
      }
    }
  }

  if (currentRelease) {
    releases.push(currentRelease);
  }

  return { releases };
}

function normalizeToVersionNumber(value = "") {
  const match = String(value).match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
  return match?.[1] ?? "";
}

function renderReleaseNotesForSelection() {
  const selectedImage = getSelectedImageInfo();
  const selectedVersion = selectedImage?.versionKey ?? versionSelect.value;
  const selectedVersionNumber = normalizeToVersionNumber(selectedVersion);
  const matchedRelease = releaseNotesCatalog?.releases?.find((release) => normalizeToVersionNumber(release.version) === selectedVersionNumber);

  releaseNotesChanges.innerHTML = "";
  releaseNotesBreakingChanges.innerHTML = "";

  if (!selectedVersion || !releaseNotesCatalog?.releases?.length) {
    releaseNotesSection.classList.add("hidden");
    return;
  }

  if (!matchedRelease) {
    releaseNotesSection.classList.remove("hidden");
    releaseNotesMeta.textContent = `Version ${selectedVersion}`;
    releaseNotesSummary.textContent = "No matching release notes found for the selected version.";
    const fallback = document.createElement("li");
    fallback.textContent = "Release notes are only shown when a matching version exists in release-notes.yml.";
    releaseNotesChanges.appendChild(fallback);
    releaseNotesBreakingHeading.classList.add("hidden");
    releaseNotesBreakingChanges.classList.add("hidden");
    return;
  }

  releaseNotesSection.classList.remove("hidden");
  releaseNotesMeta.textContent = `${matchedRelease.tag || `v${matchedRelease.version}`} • ${matchedRelease.date || "Date unavailable"}`;
  releaseNotesSummary.textContent = matchedRelease.summary || "No summary provided.";

  for (const change of matchedRelease.changes) {
    const item = document.createElement("li");
    const detail = change.area ? `${change.area}: ${change.text}` : change.text;
    item.textContent = detail || "No change details.";
    releaseNotesChanges.appendChild(item);
  }
  if (!matchedRelease.changes.length) {
    const item = document.createElement("li");
    item.textContent = "No listed changes.";
    releaseNotesChanges.appendChild(item);
  }

  if (matchedRelease.breakingChanges.length) {
    releaseNotesBreakingHeading.classList.remove("hidden");
    releaseNotesBreakingChanges.classList.remove("hidden");
    for (const breakingChange of matchedRelease.breakingChanges) {
      const item = document.createElement("li");
      item.textContent = breakingChange;
      releaseNotesBreakingChanges.appendChild(item);
    }
  } else {
    releaseNotesBreakingHeading.classList.add("hidden");
    releaseNotesBreakingChanges.classList.add("hidden");
  }
}

function refreshImageTypes() {
  if (!firmwareCatalog?.boards) {
    setOptions(imageTypeSelect, []);
    return;
  }

  const selectedFirmwareKey = getFirmwareKeyForBoard(boardSelect.value, firmwareSelect.value);
  const version = firmwareCatalog.boards?.[boardSelect.value]?.firmwares?.[selectedFirmwareKey]?.versions?.[versionSelect.value];
  const imageKeys = Object.keys(version?.images ?? {}).sort();
  const imageOptions = imageKeys.map((key) => ({
    value: key,
    label: getImageTypeLabel(key),
  }));

  setOptions(imageTypeSelect, imageOptions);
  updateContextualSections();
}

function refreshVersions() {
  if (!firmwareCatalog?.boards) {
    setOptions(versionSelect, []);
    refreshImageTypes();
    return;
  }

  const selectedFirmwareKey = getFirmwareKeyForBoard(boardSelect.value, firmwareSelect.value);
  const firmware = firmwareCatalog.boards?.[boardSelect.value]?.firmwares?.[selectedFirmwareKey];
  const versionKeys = Object.keys(firmware?.versions ?? {}).sort((a, b) => b.localeCompare(a));
  const versionOptions = versionKeys.map((key) => ({
    value: key,
    label: getVersionLabel(key, firmware?.versions?.[key], selectedFirmwareKey),
  }));

  setOptions(versionSelect, versionOptions);
  refreshImageTypes();
  renderReleaseNotesForSelection();
}

function refreshBoards() {
  if (!firmwareCatalog?.boards) {
    setOptions(boardSelect, []);
    refreshVersions();
    return;
  }

  const selectedFirmwareId = normalizeFirmwareId(firmwareSelect.value);
  const boardKeys = Object.keys(firmwareCatalog.boards)
    .filter((boardKey) => {
      if (!selectedFirmwareId) {
        return true;
      }
      const boardFirmwareKeys = Object.keys(firmwareCatalog.boards?.[boardKey]?.firmwares ?? {});
      return boardFirmwareKeys.some((firmwareKey) => normalizeFirmwareId(firmwareKey) === selectedFirmwareId);
    })
    .sort();

  const boardOptions = boardKeys.map((key) => ({
    value: key,
    label: firmwareCatalog.boards[key].display_name,
  }));

  setOptions(boardSelect, boardOptions);
  refreshVersions();
}

function populateFirmwareSelect() {
  if (!firmwareCatalog?.boards) {
    setOptions(firmwareSelect, []);
    refreshBoards();
    return;
  }

  const firmwareOptionsById = new Map();
  for (const board of Object.values(firmwareCatalog.boards)) {
    for (const [firmwareKey, firmware] of Object.entries(board?.firmwares ?? {})) {
      const firmwareId = normalizeFirmwareId(firmwareKey);
      if (!firmwareOptionsById.has(firmwareId)) {
        firmwareOptionsById.set(firmwareId, {
          value: firmwareId,
          label: normalizeFirmwareLabel(firmwareKey, firmware.display_name),
        });
      }
    }
  }

  const firmwareOptions = [...firmwareOptionsById.values()].sort((a, b) => a.label.localeCompare(b.label));
  setOptions(firmwareSelect, firmwareOptions);
  refreshBoards();
  updateContextualSections();
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
    appendLog(`Manifest unavailable (${error.message ?? error}).`);
  }

  populateFirmwareSelect();
}

async function loadReleaseNotes() {
  try {
    const response = await fetch(RELEASE_NOTES_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const yamlText = await response.text();
    releaseNotesCatalog = parseSimpleReleaseNotesYaml(yamlText);
    appendLog(`Loaded release notes (${releaseNotesCatalog.releases.length} releases).`);
  } catch (error) {
    releaseNotesCatalog = null;
    appendLog(`Release notes unavailable (${error.message ?? error}).`);
  }

  renderReleaseNotesForSelection();
}

boardSelect.addEventListener("change", refreshVersions);
firmwareSelect.addEventListener("change", refreshBoards);
versionSelect.addEventListener("change", () => {
  refreshImageTypes();
  renderReleaseNotesForSelection();
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
  } catch (error) {
    appendLog(`Connect failed: ${error.message ?? error}`);
    await safelyDisconnectFlasher();
    throw error;
  }
}

async function resolveFirmwareToFlash() {
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

  throw new Error("Select a firmware from the dropdowns first.");
}

async function downloadSelectedFirmware() {
  const selectedImage = getSelectedImageInfo();
  if (!selectedImage) {
    throw new Error("Select a firmware from the dropdowns first.");
  }

  const response = await fetch(`./firmwares/${selectedImage.path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch selected firmware (${response.status})`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = selectedImage.file_name || "firmware.bin";
    link.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
    await safelyDisconnectFlasher();
    appendLog("Flasher disconnected.");
  } catch (error) {
    appendLog(`Flash failed: ${error.message ?? error}`);
  }
});

downloadFirmwareBtn.addEventListener("click", async () => {
  try {
    await downloadSelectedFirmware();
    const selectedImage = getSelectedImageInfo();
    appendLog(`Downloaded ${selectedImage?.file_name ?? "selected firmware"}.`);
  } catch (error) {
    appendLog(`Download failed: ${error.message ?? error}`);
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
    await safelyDisconnectFlasher();
    appendLog("Flasher disconnected.");
  } catch (error) {
    appendLog(`Erase failed: ${error.message ?? error}`);
  }
});

async function safelyDisconnectFlasher() {
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
    serialInput.value = "";
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

function setSerialInputCommand(command) {
  serialInput.value = `${command} `;
  serialInput.focus();
}

quickSetWifiSsidBtn.addEventListener("click", () => {
  setSerialInputCommand("set wifi.ssid");
});

quickSetWifiPwdBtn.addEventListener("click", () => {
  setSerialInputCommand("set wifi.pwd");
});

quickSetRepeaterWifiSsidBtn.addEventListener("click", () => {
  setSerialInputCommand("set wifi.ssid");
});

quickSetRepeaterWifiPwdBtn.addEventListener("click", () => {
  setSerialInputCommand("set wifi.pwd");
});

quickSetWebOnBtn.addEventListener("click", () => {
  setSerialInputCommand("set web on");
});

quickSetWebOffBtn.addEventListener("click", () => {
  setSerialInputCommand("set web off");
});

quickGetWebStatusBtn.addEventListener("click", () => {
  setSerialInputCommand("get web.status");
});

quickGetWifiStatusBtn.addEventListener("click", () => {
  setSerialInputCommand("get wifi.status");
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
loadReleaseNotes();
