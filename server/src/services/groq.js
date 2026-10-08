import dotenv from "dotenv";
dotenv.config();

import Groq from "groq-sdk";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_FAST } from "../prompts/systemPrompt.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

let resolvedModel = process.env.MODEL || null;
let modelPromise = null;

async function getWorkingModel() {
  if (resolvedModel) return resolvedModel;
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    try {
      const modelList = await groq.models.list();
      const activeModels = new Set(modelList.data.map((m) => m.id));

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

  // Safe ceiling: Single field = 100, Multi-field = fields * 45 + 100 (JSON closing buffer)
  const maxTokens = isSingle ? 100 : Math.min(fields.length * 45 + 100, 500);

  let userPayload;

  if (isSingle) {
    const f = fields[0];
    userPayload = {
      lang: language === "bn" ? "bn" : undefined,
      field: {
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options
          ?.slice(0, 10)
          .map((o) => (typeof o === "string" ? o : o.value || o.text)),
      },
    };
  } else {
    userPayload = {
      lang: language === "bn" ? "bn" : undefined,
      page: pageContext?.title ? pageContext.title.slice(0, 40) : undefined,
      hint: hint || undefined,
      persona: persona || undefined,
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        max: f.maxLength || undefined,
        opts: f.options
          ?.slice(0, 10)
          .map((o) => (typeof o === "string" ? o : o.value || o.text)),
      })),
    };
  }

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.2,
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
