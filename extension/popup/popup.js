// Popup logic: send 'fill' message to the active tab
import { getSettings, saveSettings } from "../shared/storage.js";

const hintInput = document.getElementById("hintInput");
const languageSelect = document.getElementById("languageSelect");
const scopeSelect = document.getElementById("scopeSelect");
const personaSelect = document.getElementById("personaSelect");
const fillBtn = document.getElementById("fillBtn");
const undoBtn = document.getElementById("undoBtn");
const statusArea = document.getElementById("statusArea");
const btnSpinner = document.getElementById("btnSpinner");
const btnText = document.getElementById("btnText");
const settingsLink = document.getElementById("settingsLink");
const firstRunNotice = document.getElementById("firstRunNotice");
const dismissNoticeBtn = document.getElementById("dismissNoticeBtn");

let activeTabId = null;

function setStatus(text, isError = false) {
  statusArea.textContent = text;
  statusArea.style.color = isError ? "#ef4444" : "inherit";
}

function setLoading(isLoading) {
  fillBtn.disabled = isLoading;
  undoBtn.disabled = isLoading;
  if (isLoading) {
    btnSpinner.classList.remove("hidden");
    btnText.textContent = "Processing...";
  } else {
    btnSpinner.classList.add("hidden");
    btnText.textContent = "Fill this form";
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;

  const settings = await getSettings();

  if (!settings.firstRunNoticed) {
    firstRunNotice.classList.remove("hidden");
  }

  hintInput.value = settings.lastHint;
  languageSelect.value = settings.language;
  scopeSelect.value = settings.scope;

  // Populate Personas
  personaSelect.innerHTML =
    '<option value="none">None (Invent context)</option>';
  for (const p of settings.personas) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    personaSelect.appendChild(opt);
  }
  personaSelect.value = settings.selectedPersonaId;
}

dismissNoticeBtn.addEventListener("click", async () => {
  firstRunNotice.classList.add("hidden");
  await saveSettings({ FIRST_RUN_NOTICED: true });
});

settingsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Auto-save selections
[languageSelect, scopeSelect, personaSelect].forEach((el) => {
  el.addEventListener("change", () => {
    saveSettings({
      DEFAULT_LANGUAGE: languageSelect.value,
      FILL_SCOPE: scopeSelect.value,
      SELECTED_PERSONA_ID: personaSelect.value,
    });
  });
});

hintInput.addEventListener("input", () => {
  saveSettings({ LAST_HINT: hintInput.value });
});

fillBtn.addEventListener("click", async () => {
  if (!activeTabId) return;

  setLoading(true);
  setStatus("Scanning webpage form...");

  try {
    const scanResponse = await chrome.tabs.sendMessage(activeTabId, {
      type: "SCAN_FORM",
    });
    if (
      !scanResponse ||
      !scanResponse.fields ||
      scanResponse.fields.length === 0
    ) {
      setStatus("No fillable form fields detected on this page.", true);
      setLoading(false);
      return;
    }

    setStatus(`Found ${scanResponse.fields.length} fields. Querying AI...`);

    const settings = await getSettings();
    const activePersona =
      settings.personas.find((p) => p.id === personaSelect.value) || null;

    const fillPayload = {
      language: languageSelect.value,
      hint: hintInput.value.trim(),
      persona: activePersona,
      pageContext: scanResponse.pageContext,
      fields: scanResponse.fields,
    };

    const aiResponse = await chrome.runtime.sendMessage({
      type: "GET_FILL_DATA",
      payload: fillPayload,
    });

    if (!aiResponse.success) {
      throw new Error(aiResponse.error || "Failed to fetch form completion.");
    }

    setStatus("Filling form fields with native events...");

    const applyResult = await chrome.tabs.sendMessage(activeTabId, {
      type: "APPLY_FILL",
      values: aiResponse.values,
      scope: scopeSelect.value,
    });

    setStatus(
      `Done! Filled: ${applyResult.filled}, Skipped: ${applyResult.skipped}`,
    );
  } catch (err) {
    console.error(err);
    if (err.message.includes("Receiving end does not exist")) {
      setStatus("Cannot fill this page (restricted browser page).", true);
    } else {
      setStatus(err.message, true);
    }
  } finally {
    setLoading(false);
  }
});

undoBtn.addEventListener("click", async () => {
  if (!activeTabId) return;
  try {
    const res = await chrome.tabs.sendMessage(activeTabId, {
      type: "UNDO_FILL",
    });
    setStatus(`Restored ${res.restored} field(s) to previous values.`);
  } catch {
    setStatus("Unable to undo on this page.", true);
  }
});

init();
