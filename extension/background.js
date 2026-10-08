import { getSettings } from "./shared/storage.js";

const DIRECT_GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Ultra-lean Prompts (~80% token reduction)
const SYSTEM_PROMPT = `Generate realistic mock web form data as strict JSON {"key":"value"}. Only return the JSON object, no explanation.`;
const SYSTEM_PROMPT_FAST = `Return strictly a JSON object {"<key>":"<value>"} with a realistic mock value matching the field label and type.`;

// Setup Right-Click Context Menus safely
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
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

  const isSingle = payload.fields.length === 1;
  const maxTokens = isSingle
    ? 80
    : Math.min(payload.fields.length * 40 + 80, 450);

  // Slim Payload to minimize prompt tokens
  const userContent = JSON.stringify(
    isSingle
      ? {
          lang: payload.language === "bn" ? "bn" : undefined,
          field: {
            k: payload.fields[0].key,
            l: payload.fields[0].label,
            t: payload.fields[0].type,
            opt: payload.fields[0].options
              ?.slice(0, 10)
              .map((o) => (typeof o === "string" ? o : o.value || o.text)),
          },
        }
      : {
          lang: payload.language === "bn" ? "bn" : undefined,
          hint: payload.hint || undefined,
          persona: payload.persona || undefined,
          page: payload.pageContext?.title
            ? payload.pageContext.title.slice(0, 40)
            : undefined,
          fields: payload.fields.map((f) => ({
            k: f.key,
            l: f.label,
            t: f.type,
            max: f.maxLength || undefined,
            opt: f.options
              ?.slice(0, 10)
              .map((o) => (typeof o === "string" ? o : o.value || o.text)),
          })),
        },
  );

  const response = await fetch(DIRECT_GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "llama-3.1-8b-instant",
      temperature: 0.2, // Ultra-fast and deterministic
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: isSingle ? SYSTEM_PROMPT_FAST : SYSTEM_PROMPT,
        },
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
  let parsed;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  }
  return parsed;
}

// Reusable fill executor with Local-Value merging
async function executeFillProcess(tabId, singleTarget = false) {
  try {
    const scanRes = await chrome.tabs.sendMessage(tabId, {
      type: "SCAN_FORM",
      singleTarget,
    });

    if (!scanRes) return;

    let finalValues = { ...(scanRes.localValues || {}) };

    // Fetch AI values ONLY if non-static fields exist
    if (scanRes.fields && scanRes.fields.length > 0) {
      const settings = await getSettings();
      const payload = {
        language: settings.language,
        hint: settings.lastHint,
        persona: null,
        pageContext: scanRes.pageContext,
        fields: scanRes.fields,
      };

      const aiValues =
        settings.mode === "direct_mode"
          ? await fetchDirectGroq(
              payload,
              settings.directApiKey,
              settings.directModel,
            )
          : await fetchFromBackend(
              payload,
              settings.serverUrl,
              settings.extensionToken,
            );

      finalValues = { ...finalValues, ...aiValues };
    }

    if (Object.keys(finalValues).length > 0) {
      await chrome.tabs.sendMessage(tabId, {
        type: "APPLY_FILL",
        values: finalValues,
        scope: "overwrite",
      });
    }
  } catch (err) {
    console.error("[Smart Filler Error]", err);
  }
}

// Context Menu Click Listener
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
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
        let values = {};

        if (message.payload.fields && message.payload.fields.length > 0) {
          values =
            settings.mode === "direct_mode"
              ? await fetchDirectGroq(
                  message.payload,
                  settings.directApiKey,
                  settings.directModel,
                )
              : await fetchFromBackend(
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
