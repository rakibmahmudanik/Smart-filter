// chrome.storage helpers
import { DEFAULT_CONFIG, STORAGE_KEYS } from "./constants.js";

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.OPERATING_MODE,
        STORAGE_KEYS.SERVER_URL,
        STORAGE_KEYS.EXTENSION_TOKEN,
        STORAGE_KEYS.DIRECT_API_KEY,
        STORAGE_KEYS.DIRECT_MODEL,
        STORAGE_KEYS.DEFAULT_LANGUAGE,
        STORAGE_KEYS.SAVED_PERSONAS,
        STORAGE_KEYS.SELECTED_PERSONA_ID,
        STORAGE_KEYS.FILL_SCOPE,
        STORAGE_KEYS.LAST_HINT,
        STORAGE_KEYS.FIRST_RUN_NOTICED,
      ],
      (data) => {
        resolve({
          mode:
            data[STORAGE_KEYS.OPERATING_MODE] || DEFAULT_CONFIG.OPERATING_MODE,
          serverUrl: data[STORAGE_KEYS.SERVER_URL] || DEFAULT_CONFIG.SERVER_URL,
          extensionToken:
            data[STORAGE_KEYS.EXTENSION_TOKEN] ||
            DEFAULT_CONFIG.EXTENSION_TOKEN,
          directApiKey: data[STORAGE_KEYS.DIRECT_API_KEY] || "",
          directModel:
            data[STORAGE_KEYS.DIRECT_MODEL] || DEFAULT_CONFIG.DIRECT_MODEL,
          language:
            data[STORAGE_KEYS.DEFAULT_LANGUAGE] ||
            DEFAULT_CONFIG.DEFAULT_LANGUAGE,
          personas: data[STORAGE_KEYS.SAVED_PERSONAS] || [],
          selectedPersonaId: data[STORAGE_KEYS.SELECTED_PERSONA_ID] || "none",
          scope: data[STORAGE_KEYS.FILL_SCOPE] || DEFAULT_CONFIG.FILL_SCOPE,
          lastHint: data[STORAGE_KEYS.LAST_HINT] || "",
          firstRunNoticed: !!data[STORAGE_KEYS.FIRST_RUN_NOTICED],
        });
      },
    );
  });
}

export async function saveSettings(partialSettings) {
  const payload = {};
  for (const [key, val] of Object.entries(partialSettings)) {
    if (STORAGE_KEYS[key]) {
      payload[STORAGE_KEYS[key]] = val;
    }
  }
  return new Promise((resolve) => {
    chrome.storage.local.set(payload, resolve);
  });
}
