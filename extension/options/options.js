// Options page logic: profile data, server URL, access key
import { getSettings, saveSettings } from "../shared/storage.js";

const modeProxy = document.getElementById("modeProxy");
const modeDirect = document.getElementById("modeDirect");
const proxySection = document.getElementById("proxySection");
const directSection = document.getElementById("directSection");

const serverUrlInput = document.getElementById("serverUrl");
const serverTokenInput = document.getElementById("serverToken");
const testProxyBtn = document.getElementById("testProxyBtn");
const proxyTestResult = document.getElementById("proxyTestResult");

const directKeyInput = document.getElementById("directKey");
const directModelInput = document.getElementById("directModel");
const toggleDirectKeyBtn = document.getElementById("toggleDirectKeyBtn");
const testDirectBtn = document.getElementById("testDirectBtn");
const directTestResult = document.getElementById("directTestResult");

const personaList = document.getElementById("personaList");
const newPersonaBtn = document.getElementById("newPersonaBtn");
const personaModal = document.getElementById("personaModal");
const savePersonaBtn = document.getElementById("savePersonaBtn");
const closeModalBtn = document.getElementById("closeModalBtn");

const saveAllBtn = document.getElementById("saveAllBtn");
const saveStatus = document.getElementById("saveStatus");

let personas = [];

function renderMode(mode) {
  if (mode === "direct_mode") {
    modeDirect.checked = true;
    directSection.classList.remove("hidden");
    proxySection.classList.add("hidden");
  } else {
    modeProxy.checked = true;
    proxySection.classList.remove("hidden");
    directSection.classList.add("hidden");
  }
}

function renderPersonas() {
  personaList.innerHTML = "";
  if (!personas.length) {
    personaList.innerHTML =
      '<p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">No personas created yet.</p>';
    return;
  }

  for (const p of personas) {
    const card = document.createElement("div");
    card.className = "persona-card";
    card.innerHTML = `
      <div>
        <strong>${p.name}</strong> (${p.fullName || "No name"})<br>
        <span style="font-size: 11px; color: var(--text-muted);">${p.email || ""} • ${p.job || ""} ${p.company ? "@ " + p.company : ""}</span>
      </div>
      <div>
        <button class="btn btn-secondary btn-sm edit-p" data-id="${p.id}">Edit</button>
        <button class="btn btn-danger btn-sm del-p" data-id="${p.id}">Delete</button>
      </div>
    `;
    personaList.appendChild(card);
  }

  personaList.querySelectorAll(".del-p").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.dataset.id;
      personas = personas.filter((p) => p.id !== id);
      renderPersonas();
    });
  });

  personaList.querySelectorAll(".edit-p").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.dataset.id;
      const target = personas.find((p) => p.id === id);
      if (!target) return;

      document.getElementById("p_id").value = target.id;
      document.getElementById("p_name").value = target.name || "";
      document.getElementById("p_fullName").value = target.fullName || "";
      document.getElementById("p_email").value = target.email || "";
      document.getElementById("p_phone").value = target.phone || "";
      document.getElementById("p_job").value = target.job || "";
      document.getElementById("p_company").value = target.company || "";
      document.getElementById("p_country").value = target.country || "";
      document.getElementById("p_city").value = target.city || "";
      document.getElementById("p_address").value = target.address || "";
      document.getElementById("p_website").value = target.website || "";
      document.getElementById("p_bio").value = target.bio || "";

      personaModal.classList.remove("hidden");
    });
  });
}

async function load() {
  const settings = await getSettings();
  renderMode(settings.mode);

  serverUrlInput.value = settings.serverUrl;
  serverTokenInput.value = settings.extensionToken;

  directKeyInput.value = settings.directApiKey;
  directModelInput.value = settings.directModel;

  personas = settings.personas || [];
  renderPersonas();
}

modeProxy.addEventListener("change", () => renderMode("proxy_mode"));
modeDirect.addEventListener("change", () => renderMode("direct_mode"));

toggleDirectKeyBtn.addEventListener("click", () => {
  if (directKeyInput.type === "password") {
    directKeyInput.type = "text";
    toggleDirectKeyBtn.textContent = "Hide";
  } else {
    directKeyInput.type = "password";
    toggleDirectKeyBtn.textContent = "Show";
  }
});

// Test Proxy Backend
testProxyBtn.addEventListener("click", async () => {
  proxyTestResult.textContent = "Testing connection...";
  proxyTestResult.style.color = "var(--text-muted)";
  try {
    const res = await fetch(
      `${serverUrlInput.value.replace(/\/+$/, "")}/health`,
    );
    const data = await res.json();
    if (data.ok) {
      proxyTestResult.textContent = `Connected! Engine: ${data.engine} (${data.model})`;
      proxyTestResult.style.color = "#10b981";
    } else {
      throw new Error();
    }
  } catch {
    proxyTestResult.textContent =
      "Connection failed. Check server status and URL.";
    proxyTestResult.style.color = "#ef4444";
  }
});

// Test Direct Groq Key
testDirectBtn.addEventListener("click", async () => {
  directTestResult.textContent = "Validating key...";
  directTestResult.style.color = "var(--text-muted)";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${directKeyInput.value.trim()}`,
      },
      body: JSON.stringify({
        model: directModelInput.value.trim() || "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 5,
      }),
    });
    if (res.ok) {
      directTestResult.textContent = "Groq API Key is valid and active!";
      directTestResult.style.color = "#10b981";
    } else {
      throw new Error();
    }
  } catch {
    directTestResult.textContent = "Invalid API key or network error.";
    directTestResult.style.color = "#ef4444";
  }
});

// Modal handlers
newPersonaBtn.addEventListener("click", () => {
  document.getElementById("p_id").value = "";
  document
    .querySelectorAll("#personaModal input, #personaModal textarea")
    .forEach((i) => (i.value = ""));
  personaModal.classList.remove("hidden");
});

closeModalBtn.addEventListener("click", () => {
  personaModal.classList.add("hidden");
});

savePersonaBtn.addEventListener("click", () => {
  const pName = document.getElementById("p_name").value.trim();
  if (!pName) {
    alert("Please enter a Persona Label.");
    return;
  }

  const existingId = document.getElementById("p_id").value;
  const personaData = {
    id: existingId || `persona_${Date.now()}`,
    name: pName,
    fullName: document.getElementById("p_fullName").value.trim(),
    email: document.getElementById("p_email").value.trim(),
    phone: document.getElementById("p_phone").value.trim(),
    job: document.getElementById("p_job").value.trim(),
    company: document.getElementById("p_company").value.trim(),
    country: document.getElementById("p_country").value.trim(),
    city: document.getElementById("p_city").value.trim(),
    address: document.getElementById("p_address").value.trim(),
    website: document.getElementById("p_website").value.trim(),
    bio: document.getElementById("p_bio").value.trim(),
  };

  if (existingId) {
    personas = personas.map((p) => (p.id === existingId ? personaData : p));
  } else {
    personas.push(personaData);
  }

  personaModal.classList.add("hidden");
  renderPersonas();
});

saveAllBtn.addEventListener("click", async () => {
  const mode = modeDirect.checked ? "direct_mode" : "proxy_mode";
  await saveSettings({
    OPERATING_MODE: mode,
    SERVER_URL: serverUrlInput.value.trim(),
    EXTENSION_TOKEN: serverTokenInput.value.trim(),
    DIRECT_API_KEY: directKeyInput.value.trim(),
    DIRECT_MODEL: directModelInput.value.trim(),
    SAVED_PERSONAS: personas,
  });

  saveStatus.textContent = "Settings saved successfully!";
  saveStatus.style.color = "#10b981";
  setTimeout(() => {
    saveStatus.textContent = "";
  }, 3000);
});

load();
