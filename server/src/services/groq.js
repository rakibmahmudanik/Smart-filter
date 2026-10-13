import dotenv from "dotenv";
dotenv.config();

import Groq from "groq-sdk";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_FAST } from "../prompts/systemPrompt.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

let resolvedModel = null;
let modelPromise = null;

const VARIATION_POOL = [
  "ux designer",
  "startup engineer",
  "product manager",
  "marketing lead",
  "data analyst",
  "founder",
  "cloud architect",
  "fintech analyst",
  "researcher",
  "ops specialist",
];

function getRandomSeedHint() {
  const role =
    VARIATION_POOL[Math.floor(Math.random() * VARIATION_POOL.length)];
  const id = Math.floor(100 + Math.random() * 900);
  return `${id}:${role}`;
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

async function getWorkingModel() {
  if (resolvedModel) return resolvedModel;
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    try {
      const modelList = await groq.models.list();
      const activeModels = new Set(modelList.data.map((m) => m.id));
      const envModel = (process.env.MODEL || "").trim();

      if (envModel && activeModels.has(envModel)) {
        resolvedModel = envModel;
        return resolvedModel;
      }

      const preferredOrder = [
        "llama-3.1-8b-instant",
        "llama-3.3-70b-versatile",
        "llama3-8b-8192",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
      ];

      for (const modelId of preferredOrder) {
        if (activeModels.has(modelId)) {
          resolvedModel = modelId;
          return resolvedModel;
        }
      }

      const safeChatModel = [...activeModels].find(
        (id) =>
          !id.includes("whisper") &&
          !id.includes("orpheus") &&
          !id.includes("canopy") &&
          !id.includes("guard") &&
          !id.includes("vision") &&
          !id.includes("distil") &&
          (id.includes("llama") || id.includes("gemma") || id.includes("qwen")),
      );

      resolvedModel = safeChatModel || "llama-3.1-8b-instant";
      return resolvedModel;
    } catch (err) {
      console.error("[Smart Filler] Model fetch fallback:", err.message);
      resolvedModel = "llama-3.1-8b-instant";
      return resolvedModel;
    }
  })();

  return modelPromise;
}

export async function generateFormData({
  language,
  hint,
  persona,
  pageContext,
  fields,
}) {
  const model = await getWorkingModel();
  const isSingle = fields.length === 1;

  // Token-optimized ceiling: Single = 80, Multi = fields * 40 + 80 (capped at 600)
  const maxTokens = isSingle ? 80 : Math.min(fields.length * 40 + 80, 600);
  const seed = getRandomSeedHint();
  const cleanPersona = slimPersona(persona);

  let userPayload;

  if (isSingle) {
    const f = fields[0];
    const opts = f.options
      ?.slice(0, 10)
      .map((o) => (typeof o === "string" ? o : o.value || o.text));
    const avoidPh = f.placeholder
      ? f.placeholder
          .replace(/^(?:e\.?g\.?|ex|example|for example|যেমন)[:.,\s-]+/i, "")
          .trim()
      : "";
    userPayload = {
      seed,
      lang: language === "bn" ? "bn" : undefined,
      field: {
        key: f.key,
        label: f.label.slice(0, 80),
        type: f.type !== "text" ? f.type : undefined,
        avoid: avoidPh ? avoidPh.slice(0, 40) : undefined,
        opts: opts?.length ? opts : undefined,
      },
    };
  } else {
    userPayload = {
      seed: cleanPersona ? undefined : seed,
      lang: language === "bn" ? "bn" : undefined,
      page: pageContext?.title ? pageContext.title.slice(0, 40) : undefined,
      hint: hint ? hint.slice(0, 120) : undefined,
      persona: cleanPersona,
      fields: fields.map((f) => {
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

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.8,
    max_tokens: maxTokens,
    messages: [
      {
        role: "system",
        content: isSingle ? SYSTEM_PROMPT_FAST : SYSTEM_PROMPT,
      },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    response_format: { type: "json_object" },
  });

  const rawText = response.choices[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AI returned an unparseable response.");
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  return {
    values: parsed,
    usage: response.usage || { prompt_tokens: 0, completion_tokens: 0 },
  };
}
