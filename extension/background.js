import { getSettings, saveSettings } from "./shared/storage.js";

const DIRECT_GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DIRECT_GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";

// Ultra-lean Prompts to minimize prompt token consumption & forbid copying placeholders
const SYSTEM_PROMPT = `Return ONLY a JSON object {"<key>":"<value>"} mapping each field "key" to realistic mock data. Use "seed" for a unique identity (unless "persona" is set). NEVER copy placeholder examples or field labels—invent a new realistic value. Follow "opts" for select/radio, "max" length, ISO dates, and "lang" ("bn"=Bengali text, Latin email/URL).`;

const SYSTEM_PROMPT_FAST = `Return ONLY a JSON object {"<key>":"<value>"} with a fresh realistic mock value matching "label", "type", "opts", and "seed". NEVER output the placeholder text, "avoid" text, or field label itself—invent a new realistic value.`;

const VARIATION_POOL = [
  "ux designer, Dhaka",
  "software engineer, Sylhet",
  "product manager, Chittagong",
  "marketing lead, Rajshahi",
  "data analyst, Khulna",
  "startup founder, Barisal",
  "cloud architect, Rangpur",
  "fintech analyst, Mymensingh",
  "medical researcher, Comilla",
  "operations lead, Gazipur",
  "creative director, Narayanganj",
  "cybersecurity specialist, Bogra",
];

function getRandomSeedHint() {
  const role =
    VARIATION_POOL[Math.floor(Math.random() * VARIATION_POOL.length)];
  const id = Math.floor(1000 + Math.random() * 9000);
  return `${id}:${role}`;
}

function extractPlaceholderExample(ph) {
  if (!ph) return "";
  return ph
    .replace(/^(?:e\.?g\.?|ex|example|for example|যেমন)[:.,\s-]+/i, "")
    .trim();
}

function slimPersona(persona) {
  if (!persona || typeof persona !== "object") return undefined;
  const slim = {};
  for (const [k, v] of Object.entries(persona)) {
    if (k === "id" || k === "name") continue;
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      slim[k] = String(v).trim().slice(0, 80);
    }
  }
  return Object.keys(slim).length > 0 ? slim : undefined;
}

// Zero-token local matcher for Persona fields (skips sending matched fields to AI)
function matchPersonaFieldsLocally(fields, persona) {
  if (!persona || typeof persona !== "object") {
    return { localValues: {}, remainingFields: fields };
  }

  const localValues = {};
  const remainingFields = [];

  for (const f of fields) {
    if (f.options && f.options.length > 0) {
      remainingFields.push(f);
      continue;
    }

    const sig = `${f.label || ""} ${f.name || ""} ${f.id || ""} ${f.autocomplete || ""}`.toLowerCase();
    let matched = null;

    if ((f.type === "email" || /\be-?mail\b/.test(sig)) && persona.email) {
      matched = persona.email;
    } else if ((f.type === "tel" || /\b(phone|mobile|cell|contact no)\b/.test(sig)) && persona.phone) {
      matched = persona.phone;
    } else if ((f.type === "url" || /\b(website|portfolio|github|linkedin|url)\b/.test(sig)) && persona.website) {
      matched = persona.website;
    } else if (/\b(full\s*name|your\s*name|applicant\s*name|^name$)\b/.test(sig.trim()) && persona.fullName) {
      matched = persona.fullName;
    } else if (/\b(first\s*name|given\s*name|fname)\b/.test(sig) && persona.fullName) {
      matched = persona.fullName.split(/\s+/)[0];
    } else if (/\b(last\s*name|surname|family\s*name|lname)\b/.test(sig) && persona.fullName) {
      const parts = persona.fullName.trim().split(/\s+/);
      matched = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
    } else if (/\b(company|organization|employer|workplace)\b/.test(sig) && persona.company) {
      matched = persona.company;
    } else if (/\b(job\s*title|designation|position|role|occupation)\b/.test(sig) && persona.job) {
      matched = persona.job;
    } else if (/\b(city|town|district)\b/.test(sig) && persona.city) {
      matched = persona.city;
    } else if (/\b(country|nation)\b/.test(sig) && persona.country) {
      matched = persona.country;
    } else if (/\b(street|address)\b/.test(sig) && persona.address) {
      matched = persona.address;
    } else if (/\b(bio|about\s*me|summary|profile)\b/.test(sig) && persona.bio) {
      matched = persona.bio;
    }

    if (matched) {
      localValues[f.key] = matched;
    } else {
      remainingFields.push(f);
    }
  }

  return { localValues, remainingFields };
}

// 1-Minute In-Memory LRU Cache for Multi-Field forms (0 tokens for repeated fills within 60 seconds)
const responseCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute
const MAX_CACHE_ENTRIES = 50;

function getCacheKey(payload, mode) {
  const fieldSig = (payload.fields || [])
    .map(
      (f) =>
        `${f.name || f.id || f.label || "f"}:${f.label || ""}:${f.type || "text"}`,
    )
    .join("|");
  return `${mode}:${payload.language || "en"}:${payload.hint || ""}:${payload.persona?.id || "none"}:${fieldSig}`;
}

export function cleanApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return "";
  return rawKey
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^GROQ_API_KEY\s*=\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

const modelCache = new Map();

function isSafeChatModel(id) {
  const lower = id.toLowerCase();
  return (
    !lower.includes("whisper") &&
    !lower.includes("orpheus") &&
    !lower.includes("canopy") &&
    !lower.includes("guard") &&
    !lower.includes("vision") &&
    !lower.includes("distil") &&
    !lower.includes("tts") &&
    !lower.includes("playai") &&
    !lower.includes("embed") &&
    (lower.includes("llama") ||
      lower.includes("gemma") ||
      lower.includes("qwen") ||
      lower.includes("mixtral") ||
      lower.includes("deepseek"))
  );
}

async function resolveDirectGroqModel(apiKey, preferredModel, forceRefresh = false) {
  const cleanKey = cleanApiKey(apiKey);
  const cleanPreferred = (preferredModel || "").trim();
  const cacheKey = `${cleanKey.slice(-8)}:${cleanPreferred}`;

  if (!forceRefresh && modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey);
  }

  const res = await fetch(DIRECT_GROQ_MODELS_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cleanKey}`,
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg =
      errData.error?.message ||
      (res.status === 401
        ? "Invalid Groq API Key (Unauthorized). Please check your gsk_... key."
        : `Groq API error (HTTP ${res.status})`);
    throw new Error(msg);
  }

  const modelList = await res.json();
  const activeModels = new Set((modelList.data || []).map((m) => m.id));

  if (cleanPreferred && activeModels.has(cleanPreferred) && isSafeChatModel(cleanPreferred)) {
    modelCache.set(cacheKey, cleanPreferred);
    return cleanPreferred;
  }

  const preferredOrder = [
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "llama3-8b-8192",
    "llama3-70b-8192",
    "gemma2-9b-it",
    "mixtral-8x7b-32768",
  ];

  for (const candidate of preferredOrder) {
    if (activeModels.has(candidate)) {
      modelCache.set(cacheKey, candidate);
      return candidate;
    }
  }

  const fallback = [...activeModels].find(isSafeChatModel) || "llama-3.1-8b-instant";
  modelCache.set(cacheKey, fallback);
  return fallback;
}

async function testDirectGroqKey(rawKey, preferredModel) {
  const cleanKey = cleanApiKey(rawKey);
  if (!cleanKey) {
    throw new Error("Please enter a Groq API Key first.");
  }

  const workingModel = await resolveDirectGroqModel(cleanKey, preferredModel, true);

  const res = await fetch(DIRECT_GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify({
      model: workingModel,
      messages: [{ role: "user", content: "OK" }],
      max_tokens: 3,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData.error?.message || `Groq chat check failed (HTTP ${res.status})`,
    );
  }

  return {
    valid: true,
    model: workingModel,
    cleanKey,
  };
}

// Setup Right-Click Context Menus cleanly without unauthorized tab scripting
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
  const seed = getRandomSeedHint();
  const isSingle = payload.fields.length === 1;

  // Ensure fresh generation after 1m cache expiry (or on single-field) and prevent placeholder copying
  const outboundPayload = {
    ...payload,
    hint: payload.hint
      ? `${payload.hint} [seed:${seed}]`.slice(0, 290)
      : `Unique profile [seed:${seed}]; never copy placeholder examples.`,
    fields: isSingle
      ? payload.fields.map((f) => {
          const avoidPh = extractPlaceholderExample(f.placeholder);
          const avoidNote = avoidPh ? `, do NOT use '${avoidPh}'` : "";
          return {
            ...f,
            label: `${f.label} (invent new random value [${seed}]${avoidNote})`,
          };
        })
      : payload.fields,
  };

  const response = await fetch(`${cleanUrl}/api/fill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Extension-Token": token,
    },
    body: JSON.stringify(outboundPayload),
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
  const cleanKey = cleanApiKey(apiKey);
  if (!cleanKey) {
    throw new Error(
      "Groq API Key is missing. Open Settings to configure your key.",
    );
  }

  const workingModel = await resolveDirectGroqModel(cleanKey, model);
  const isSingle = payload.fields.length === 1;
  const maxTokens = isSingle
    ? 80
    : Math.min(payload.fields.length * 40 + 80, 600);

  const seed = getRandomSeedHint();
  const cleanPersona = slimPersona(payload.persona);

  let userPayload;
  if (isSingle) {
    const f = payload.fields[0];
    const opts = f.options
      ?.slice(0, 10)
      .map((o) => (typeof o === "string" ? o : o.value || o.text));
    const avoidPh = extractPlaceholderExample(f.placeholder);
    userPayload = {
      seed,
      lang: payload.language === "bn" ? "bn" : undefined,
      field: {
        key: f.key,
        label: f.label.slice(0, 50),
        type: f.type !== "text" ? f.type : undefined,
        avoid: avoidPh ? avoidPh.slice(0, 40) : undefined,
        opts: opts?.length ? opts : undefined,
      },
    };
  } else {
    userPayload = {
      seed: cleanPersona ? undefined : seed,
      lang: payload.language === "bn" ? "bn" : undefined,
      hint: payload.hint ? payload.hint.slice(0, 120) : undefined,
      persona: cleanPersona,
      page: payload.pageContext?.title
        ? payload.pageContext.title.slice(0, 40)
        : undefined,
      fields: payload.fields.map((f) => {
        const opts = f.options
          ?.slice(0, 10)
          .map((o) => (typeof o === "string" ? o : o.value || o.text));
        return {
          key: f.key,
          label: f.label.slice(0, 50),
          type: f.type !== "text" ? f.type : undefined,
          max: f.maxLength > 0 && f.maxLength < 300 ? f.maxLength : undefined,
          opts: opts?.length ? opts : undefined,
        };
      }),
    };
  }

  const response = await fetch(DIRECT_GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify({
      model: workingModel,
      temperature: 0.85,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: isSingle ? SYSTEM_PROMPT_FAST : SYSTEM_PROMPT,
        },
        { role: "user", content: JSON.stringify(userPayload) },
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

// Smart token-saving orchestrator: 1m cache for single fields & full forms + zero-token persona match
async function getSmartFillValues(payload, settings) {
  if (!payload.fields || payload.fields.length === 0) {
    return {};
  }

  const isSingleField = payload.fields.length === 1;
  const cacheKey = getCacheKey(payload, settings.mode);

  // 1-minute in-memory LRU cache hit (0 tokens for repeated fills within 60 seconds)
  if (cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      if (isSingleField) {
        const currentKey = payload.fields[0].key;
        const singleVal =
          cached.values[currentKey] ?? Object.values(cached.values)[0];
        return singleVal !== undefined
          ? { [currentKey]: singleVal }
          : cached.values;
      }
      return cached.values;
    }
  }

  // Match known Persona fields locally (0 tokens)
  const { localValues, remainingFields } = matchPersonaFieldsLocally(
    payload.fields,
    payload.persona,
  );

  let aiValues = {};
  if (remainingFields.length > 0) {
    const reducedPayload = {
      ...payload,
      fields: remainingFields,
    };

    aiValues =
      settings.mode === "direct_mode"
        ? await fetchDirectGroq(
            reducedPayload,
            settings.directApiKey,
            settings.directModel,
          )
        : await fetchFromBackend(
            reducedPayload,
            settings.serverUrl,
            settings.extensionToken,
          );
  }

  const combined = { ...localValues, ...aiValues };

  if (cacheKey) {
    if (responseCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = responseCache.keys().next().value;
      responseCache.delete(firstKey);
    }
    responseCache.set(cacheKey, {
      values: combined,
      timestamp: Date.now(),
    });
  }

  return combined;
}

// Ensure content scripts are active on the target tab
async function ensureContentScriptInjected(tabId) {
  try {
    const res = await chrome.tabs
      .sendMessage(tabId, { type: "PING" })
      .catch(() => null);
    if (res?.status === "ok") return true;

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "content/formScanner.js",
        "content/formFiller.js",
        "content/content.js",
      ],
    });
    // Brief tick to allow listeners to bind
    await new Promise((resolve) => setTimeout(resolve, 80));
    return true;
  } catch (err) {
    console.warn(
      "[Smart Filler] Content script injection skipped:",
      err.message,
    );
    return false;
  }
}

// Reusable fill executor with Local-Value merging & visual toasts
async function executeFillProcess(tabId, singleTarget = false) {
  try {
    const ready = await ensureContentScriptInjected(tabId);
    if (!ready) return;

    // Show loading status toast on page
    chrome.tabs
      .sendMessage(tabId, {
        type: "SHOW_TOAST",
        text: singleTarget
          ? "⚡ Smart Filler: Generating value for this input..."
          : "⚡ Smart Filler: Scanning & generating inputs...",
        variant: "loading",
        duration: 15000,
      })
      .catch(() => {});

    const scanRes = await chrome.tabs.sendMessage(tabId, {
      type: "SCAN_FORM",
      singleTarget,
    });

    if (
      !scanRes ||
      ((!scanRes.fields || scanRes.fields.length === 0) &&
        Object.keys(scanRes.localValues || {}).length === 0)
    ) {
      chrome.tabs
        .sendMessage(tabId, {
          type: "SHOW_TOAST",
          text: singleTarget
            ? "ℹ️ Smart Filler: Please click inside an input field first."
            : "ℹ️ Smart Filler: No fillable form fields found.",
          variant: "info",
          duration: 3000,
        })
        .catch(() => {});
      return;
    }

    let finalValues = { ...(scanRes.localValues || {}) };

    if (scanRes.fields && scanRes.fields.length > 0) {
      const settings = await getSettings();
      const activePersona =
        (settings.personas || []).find(
          (p) => p.id === settings.selectedPersonaId,
        ) || null;

      const payload = {
        language: settings.language,
        hint: settings.lastHint,
        persona: activePersona,
        pageContext: scanRes.pageContext,
        fields: scanRes.fields,
      };

      const aiValues = await getSmartFillValues(payload, settings);
      finalValues = { ...finalValues, ...aiValues };

      if (singleTarget && scanRes.fields.length === 1) {
        const targetKey = scanRes.fields[0].key;
        const singleVal =
          finalValues[targetKey] ?? Object.values(finalValues)[0];
        finalValues = singleVal !== undefined ? { [targetKey]: singleVal } : {};
      }
    }

    if (Object.keys(finalValues).length > 0) {
      const fillReport = await chrome.tabs.sendMessage(tabId, {
        type: "APPLY_FILL",
        values: finalValues,
        scope: "overwrite",
      });

      const filledCount =
        fillReport?.filled ?? Object.keys(finalValues).length;
      chrome.tabs
        .sendMessage(tabId, {
          type: "SHOW_TOAST",
          text: singleTarget
            ? "✅ Smart Filler: Filled active input!"
            : `✅ Smart Filler: Filled ${filledCount} field${filledCount === 1 ? "" : "s"}!`,
          variant: "success",
          duration: 3000,
        })
        .catch(() => {});
    } else {
      chrome.tabs
        .sendMessage(tabId, {
          type: "SHOW_TOAST",
          text: "ℹ️ Smart Filler: No fields were modified.",
          variant: "info",
          duration: 3000,
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error("[Smart Filler Error]", err);
    chrome.tabs
      .sendMessage(tabId, {
        type: "SHOW_TOAST",
        text: `❌ Smart Filler: ${err.message || "Failed to fill form"}`,
        variant: "error",
        duration: 4500,
      })
      .catch(() => {});
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

// Popup & Options Message Hub
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TEST_DIRECT_GROQ") {
    (async () => {
      try {
        const result = await testDirectGroqKey(message.apiKey, message.model);
        await saveSettings({
          OPERATING_MODE: "direct_mode",
          DIRECT_API_KEY: result.cleanKey,
          DIRECT_MODEL: result.model,
        });
        sendResponse({
          success: true,
          model: result.model,
          cleanKey: result.cleanKey,
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "GET_FILL_DATA") {
    (async () => {
      try {
        const settings = await getSettings();
        const values = await getSmartFillValues(message.payload, settings);
        sendResponse({ success: true, values });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

// Shortcut command listener:
// 1. fill-form: Entire Form (Ctrl+Shift+F on Win/Linux, Alt+Shift+F on Mac)
// 2. fill-single-input: Single Input Only (Alt+Shift+I on Win/Linux, Alt+Shift+I on Mac)
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "fill-form" || command === "fill-single-input") {
    let targetTab = tab;
    if (!targetTab?.id) {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      targetTab = activeTab;
    }

    if (!targetTab?.id) return;

    const url = targetTab.url || "";
    if (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("edge://") ||
      url.startsWith("devtools://") ||
      url.startsWith("about:") ||
      url.includes("chromewebstore.google.com")
    ) {
      console.warn(
        "[Smart Filler] Cannot run on restricted browser page:",
        url,
      );
      return;
    }

    const isSingle = command === "fill-single-input";
    await executeFillProcess(targetTab.id, isSingle);
  }
});
