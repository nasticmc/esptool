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

let esploader = null;
let transport = null;
let flasherPort = null;

let firmwareCatalog = null;
let releaseNotesCatalog = null;

const FLASH_BAUD_RATE = 460800;
const SERIAL_BAUD_RATE = 115200;
const RELEASE_NOTES_URLS = [
  "./firmwares/release-notes.yml",
  "https://raw.githubusercontent.com/xJARiD/MeshCore-EastMesh/main/release-notes.yml",
  "https://raw.githubusercontent.com/xJARiD/MeshCore-EastMesh/refs/heads/main/release-notes.yml",
];

const consoleArea = document.getElementById("console");
const consoleInput = document.getElementById("consoleInput");
const consoleSendBtn = document.getElementById("consoleSendBtn");
const consoleConnectBtn = document.getElementById("consoleConnectBtn");
const consoleDisconnectBtn = document.getElementById("consoleDisconnectBtn");
const consoleClearBtn = document.getElementById("consoleClearBtn");
const consoleStatus = document.getElementById("consoleStatus");
const presetCommandButtons = document.querySelectorAll(".preset-command-btn");

let serialPort = null;
let serialReader = null;
let serialWriter = null;
let serialReadLoop = null;
let serialKeepReading = false;
const serialDecoder = new TextDecoder();

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

function getFirmwareKeyForBoard(boardKey, firmwareId) {
  const firmwares = firmwareCatalog?.boards?.[boardKey]?.firmwares;
  if (!firmwares) {
    return null;
  }

  const normalizedId = normalizeFirmwareId(firmwareId);
  return Object.keys(firmwares).find((firmwareKey) => normalizeFirmwareId(firmwareKey) === normalizedId) ?? null;
}

function getSelectedFirmwareMetadata() {
  const board = firmwareCatalog?.boards?.[boardSelect.value];
  const firmwareKey = getFirmwareKeyForBoard(boardSelect.value, firmwareSelect.value);
  const firmware = board?.firmwares?.[firmwareKey];

  return {
    key: firmwareKey ?? "",
    displayName: firmware?.display_name ?? "",
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

function createEmptyReleaseNote() {
  return {
    track: "",
    version: "",
    tag: "",
    date: "",
    summary: "",
    changes: [],
    breakingChanges: [],
  };
}

function parseSimpleReleaseNotesYaml(yamlText) {
  const lines = String(yamlText).split(/\r?\n/);
  const releases = [];
  let currentRelease = null;
  let currentChange = null;
  let inReleases = false;
  let currentSection = "";

  function flushCurrentChange() {
    if (currentRelease && currentChange?.text) {
      currentRelease.changes.push(currentChange);
    }
    currentChange = null;
  }

  function flushCurrentRelease() {
    if (currentRelease) {
      flushCurrentChange();
      releases.push(currentRelease);
    }
    currentRelease = null;
    currentSection = "";
  }

  for (const line of lines) {
    if (!inReleases) {
      if (/^releases:\s*$/.test(line)) {
        inReleases = true;
      }
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    const releaseStartMatch = line.match(/^  -\s*(?:([a-z_]+):\s*(.*)\s*)?$/);
    if (releaseStartMatch) {
      flushCurrentRelease();
      currentRelease = createEmptyReleaseNote();
      const [, inlineKey, inlineValue] = releaseStartMatch;
      if (inlineKey === "track") {
        currentRelease.track = stripOptionalQuotes(inlineValue ?? "");
      } else if (inlineKey === "version") {
        currentRelease.version = stripOptionalQuotes(inlineValue ?? "");
      } else if (inlineKey === "tag") {
        currentRelease.tag = stripOptionalQuotes(inlineValue ?? "");
      } else if (inlineKey === "date") {
        currentRelease.date = stripOptionalQuotes(inlineValue ?? "");
      } else if (inlineKey === "summary") {
        currentRelease.summary = stripOptionalQuotes(inlineValue ?? "");
      }
      continue;
    }

    if (!currentRelease) {
      continue;
    }

    const topLevelInRelease = line.match(/^    ([a-z_]+):\s*(.*)\s*$/);
    if (topLevelInRelease) {
      const [, key, rawValue] = topLevelInRelease;
      if (key === "changes") {
        flushCurrentChange();
        currentSection = "changes";
        continue;
      }
      if (key === "breaking_changes") {
        flushCurrentChange();
        currentSection = "breaking_changes";
        if (rawValue === "[]") {
          currentSection = "";
        }
        continue;
      }
      flushCurrentChange();
      currentSection = "";
      if (key === "version" || key === "tag" || key === "date" || key === "summary") {
        currentRelease[key] = stripOptionalQuotes(rawValue);
      } else if (key === "track") {
        currentRelease.track = stripOptionalQuotes(rawValue);
      }
      continue;
    }

    if (currentSection === "changes") {
      const changeStartMatch = line.match(/^      -\s*([a-z_]+):\s*(.+)\s*$/);
      if (changeStartMatch) {
        flushCurrentChange();
        const [, changeKey, changeValue] = changeStartMatch;
        currentChange = { type: "", area: "", text: "" };
        currentChange[changeKey] = stripOptionalQuotes(changeValue);
        continue;
      }

      const changeFieldMatch = line.match(/^        ([a-z_]+):\s*(.+)\s*$/);
      if (changeFieldMatch && currentChange) {
        const [, key, value] = changeFieldMatch;
        currentChange[key] = stripOptionalQuotes(value);
        continue;
      }
      continue;
    }

    if (currentSection === "breaking_changes") {
      const breakingChangeMatch = line.match(/^      -\s*(.+)\s*$/);
      if (breakingChangeMatch) {
        currentRelease.breakingChanges.push(stripOptionalQuotes(breakingChangeMatch[1]));
      }
    }
  }

  flushCurrentRelease();

  return { releases };
}

function normalizeToVersionNumber(value = "") {
  const match = String(value).match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
  return match?.[1] ?? "";
}

function normalizeReleaseTrack(value = "") {
  return String(value).trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function getReleaseTrackForSelection() {
  const firmware = getSelectedFirmwareMetadata();
  const source = `${firmware.key} ${firmware.displayName}`.toLowerCase();
  if (source.includes("repeater") && source.includes("mqtt")) {
    return "repeater-mqtt";
  }
  if (source.includes("companion") && source.includes("wifi")) {
    return "companion-wifi";
  }
  return "";
}

function renderReleaseNotesForSelection() {
  const selectedImage = getSelectedImageInfo();
  const selectedVersion = selectedImage?.versionKey ?? versionSelect.value;
  const selectedVersionNumber = normalizeToVersionNumber(selectedVersion);
  const selectedTrack = getReleaseTrackForSelection();
  const matchedRelease = releaseNotesCatalog?.releases?.find((release) => {
    const sameVersion = normalizeToVersionNumber(release.version) === selectedVersionNumber;
    if (!sameVersion) {
      return false;
    }
    if (!selectedTrack) {
      return true;
    }
    return normalizeReleaseTrack(release.track) === selectedTrack;
  });

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
  const trackSuffix = matchedRelease.track ? ` • ${matchedRelease.track}` : "";
  releaseNotesMeta.textContent = `${matchedRelease.tag || `v${matchedRelease.version}`} • ${matchedRelease.date || "Date unavailable"}${trackSuffix}`;
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
}

async function loadFirmwareManifest() {
  try {
    const response = await fetch("./firmwares/manifest.json", { cache: "reload" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    firmwareCatalog = await response.json();
  } catch (error) {
    firmwareCatalog = null;
    appendLog(`Manifest unavailable (${error.message ?? error}).`);
  }

  populateFirmwareSelect();
}

async function loadReleaseNotes() {
  try {
    let yamlText = "";
    let lastFetchError = null;

    for (const releaseNotesUrl of RELEASE_NOTES_URLS) {
      try {
        const response = await fetch(releaseNotesUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        yamlText = await response.text();
        break;
      } catch (error) {
        lastFetchError = error;
      }
    }

    if (!yamlText) {
      throw new Error(lastFetchError?.message ?? "Unable to fetch release notes from configured URLs.");
    }

    releaseNotesCatalog = parseSimpleReleaseNotesYaml(yamlText);
    if (!releaseNotesCatalog.releases.length) {
      throw new Error("Release notes loaded but no releases were parsed.");
    }

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
    await safelyDisconnectFlasher();
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
    await safelyDisconnectFlasher();
  }
});

async function safelyDisconnectFlasher() {
  esploader = null;
  if (flasherPort) {
    try {
      await flasherPort.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      // Ignore if signals can't be cleared (e.g. port already closed).
    }
  }
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

function appendConsole(text) {
  consoleArea.value += text;
  consoleArea.scrollTop = consoleArea.scrollHeight;
}

function setConsoleStatus(message, connected) {
  consoleStatus.textContent = message;
  consoleStatus.classList.toggle("is-connected", Boolean(connected));
}

function setConsoleConnected(connected) {
  consoleConnectBtn.disabled = connected;
  consoleDisconnectBtn.disabled = !connected;
  consoleInput.disabled = !connected;
  consoleSendBtn.disabled = !connected;
  setConsoleStatus(
    connected ? `Connected at ${SERIAL_BAUD_RATE} baud.` : "Disconnected.",
    connected,
  );
}

async function readSerialLoop() {
  try {
    while (serialKeepReading && serialPort?.readable) {
      serialReader = serialPort.readable.getReader();
      try {
        while (true) {
          const { value, done } = await serialReader.read();
          if (done) {
            break;
          }
          if (value) {
            appendConsole(serialDecoder.decode(value, { stream: true }));
          }
        }
      } catch (error) {
        appendConsole(`\n[read error: ${error.message ?? error}]\n`);
      } finally {
        try {
          serialReader.releaseLock();
        } catch {
          // Ignore lock release errors.
        }
        serialReader = null;
      }
    }
  } finally {
    serialReadLoop = null;
  }
}

async function connectSerialConsole() {
  if (serialPort) {
    return;
  }
  try {
    ensureWebSerial();
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: SERIAL_BAUD_RATE });
    try {
      await serialPort.setSignals({ dataTerminalReady: true, requestToSend: false });
    } catch {
      // Some adapters don't support setSignals — that's fine.
    }
    serialWriter = serialPort.writable.getWriter();
    serialKeepReading = true;
    setConsoleConnected(true);
    appendConsole(`\n[connected at ${SERIAL_BAUD_RATE} baud]\n`);
    serialReadLoop = readSerialLoop();
    consoleInput.focus();
  } catch (error) {
    appendConsole(`\n[connect failed: ${error.message ?? error}]\n`);
    await disconnectSerialConsole();
  }
}

async function disconnectSerialConsole() {
  serialKeepReading = false;
  if (serialReader) {
    try {
      await serialReader.cancel();
    } catch {
      // Ignore cancel errors.
    }
  }
  if (serialWriter) {
    try {
      serialWriter.releaseLock();
    } catch {
      // Ignore release errors.
    }
    serialWriter = null;
  }
  if (serialReadLoop) {
    try {
      await serialReadLoop;
    } catch {
      // Ignore loop exit errors.
    }
    serialReadLoop = null;
  }
  if (serialPort) {
    try {
      await serialPort.close();
    } catch {
      // Ignore close errors.
    }
    serialPort = null;
  }
  setConsoleConnected(false);
  appendConsole("\n[disconnected]\n");
}

async function sendConsoleInput() {
  if (!serialWriter) {
    return;
  }
  const text = consoleInput.value;
  const payload = `${text}\r\n`;
  try {
    await serialWriter.write(new TextEncoder().encode(payload));
    consoleInput.value = "";
  } catch (error) {
    appendConsole(`\n[write error: ${error.message ?? error}]\n`);
  }
}

function prefillConsoleInput(command) {
  consoleInput.value = command;
  if (!consoleInput.disabled) {
    consoleInput.focus();
    consoleInput.setSelectionRange(consoleInput.value.length, consoleInput.value.length);
  }
}

consoleConnectBtn.addEventListener("click", () => {
  connectSerialConsole();
});

consoleDisconnectBtn.addEventListener("click", () => {
  disconnectSerialConsole();
});

consoleClearBtn.addEventListener("click", () => {
  consoleArea.value = "";
});

consoleSendBtn.addEventListener("click", () => {
  sendConsoleInput();
});

consoleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendConsoleInput();
  }
});

for (const button of presetCommandButtons) {
  button.addEventListener("click", () => {
    const command = button.dataset.command ?? button.textContent ?? "";
    prefillConsoleInput(command);
  });
}

window.addEventListener("beforeunload", () => {
  if (serialPort) {
    disconnectSerialConsole();
  }
});

loadFirmwareManifest();
loadReleaseNotes();
