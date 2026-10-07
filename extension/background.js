import { getSettings } from "./shared/storage.js";

const DIRECT_GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DIRECT_SYSTEM_PROMPT = `You are Smart Filler. Generate realistic mock form data in JSON. Return ONLY a valid JSON object mapping each field key to its value. No markdown, no preambles.`;

// Setup Right-Click Context Menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "smartfill-root",
    title: "Smart Filler ⚡",
    contexts: ["editable", "page"],
  });

  chrome.contextMenus.create({
    parentId: "smartfill-root",
    id: "smartfill-this-input",
    title: "Fill this input only (Save tokens)",
    contexts: ["editable"],
  });

  chrome.contextMenus.create({
    parentId: "smartfill-root",
    id: "smartfill-this-form",
    title: "Fill entire form",
    contexts: ["editable", "page"],
  });
});

async function fetchFromBackend(payload, serverUrl, token) {
  const cleanUrl = serverUrl.replace(/\/+$/, "");
  const response = await fetch(`${cleanUrl}/api/fill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Extension-Token": token,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error || `Server responded with HTTP status ${response.status}`,
    );
  }

  const result = await response.json();
  return result.values;
}

async function fetchDirectGroq(payload, apiKey, model) {
  if (!apiKey) {
    throw new Error(
      "Groq API Key is missing. Open Settings to configure your key.",
    );
  }

  const userContent = JSON.stringify({
    language: payload.language,
    hint: payload.hint,
    persona: payload.persona,
    pageContext: payload.pageContext,
    fields: payload.fields,
  });

  const response = await fetch(DIRECT_GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "llama3-8b-8192",
      temperature: 0.7,
      max_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DIRECT_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      err.error?.message ||
        `Groq API responded with error status ${response.status}`,
    );
  }

  const data = await response.json();
  const rawText = data.choices[0]?.message?.content || "{}";
  return JSON.parse(rawText);
}

// Reusable fill executor
async function executeFillProcess(tabId, singleTarget = false) {
  try {
    const scanRes = await chrome.tabs.sendMessage(tabId, {
      type: "SCAN_FORM",
      singleTarget,
    });

    if (!scanRes || !scanRes.fields || !scanRes.fields.length) return;

    const settings = await getSettings();
    const payload = {
      language: settings.language,
      hint: settings.lastHint,
      persona: null,
      pageContext: scanRes.pageContext,
      fields: scanRes.fields,
    };

    let values;
    if (settings.mode === "direct_mode") {
      values = await fetchDirectGroq(
        payload,
        settings.directApiKey,
        settings.directModel,
      );
    } else {
      values = await fetchFromBackend(
        payload,
        settings.serverUrl,
        settings.extensionToken,
      );
    }

    await chrome.tabs.sendMessage(tabId, {
      type: "APPLY_FILL",
      values,
      scope: "overwrite", // context menu click always fills the target
    });
  } catch (err) {
    console.error("[Smart Filler Error]", err);
  }
}

// Context Menu Click Listener
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === "smartfill-this-input") {
    executeFillProcess(tab.id, true);
  } else if (info.menuItemId === "smartfill-this-form") {
    executeFillProcess(tab.id, false);
  }
});

// Popup Message Hub
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_FILL_DATA") {
    (async () => {
      try {
        const settings = await getSettings();
        let values;

        if (settings.mode === "direct_mode") {
          values = await fetchDirectGroq(
            message.payload,
            settings.directApiKey,
            settings.directModel,
          );
        } else {
          values = await fetchFromBackend(
            message.payload,
            settings.serverUrl,
            settings.extensionToken,
          );
        }

        sendResponse({ success: true, values });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// Shortcut command listener (Ctrl+Shift+F)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "fill-form") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      executeFillProcess(tab.id, false);
    }
  }
});
