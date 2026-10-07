import dotenv from "dotenv";
dotenv.config();

import Groq from "groq-sdk";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_FAST } from "../prompts/systemPrompt.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

let resolvedModel = null;

async function getWorkingModel() {
  if (resolvedModel) return resolvedModel;

  try {
    const modelList = await groq.models.list();
    const activeModels = modelList.data.map((m) => m.id);

    // অগ্রাধিকারপ্রাপ্ত জনপ্রিয় ও ফ্রি চ্যাট মডেলগুলো
    const preferredOrder = [
      "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile",
      "llama3-8b-8192",
      "llama3-70b-8192",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ];

    for (const modelId of preferredOrder) {
      if (activeModels.includes(modelId)) {
        resolvedModel = modelId;
        console.log(
          `[Smart Filler] Active chat model selected: ${resolvedModel}`,
        );
        return resolvedModel;
      }
    }

    // টার্মস রিকয়ার্ড, অডিও বা থার্ড পার্টি প্রিভিউ মডেল ফিল্টার আউট করা
    const safeChatModel = activeModels.find(
      (id) =>
        !id.includes("whisper") &&
        !id.includes("orpheus") &&
        !id.includes("canopy") &&
        !id.includes("guard") &&
        !id.includes("vision") &&
        !id.includes("distil") &&
        (id.includes("llama") ||
          id.includes("gemma") ||
          id.includes("mixtral") ||
          id.includes("qwen")),
    );

    if (safeChatModel) {
      resolvedModel = safeChatModel;
      console.log(
        `[Smart Filler] Safe fallback model selected: ${resolvedModel}`,
      );
      return resolvedModel;
    }
  } catch (err) {
    console.error(
      "[Smart Filler] Failed to query Groq model list:",
      err.message,
    );
  }

  // শেষ নিরাপদ ডিফল্ট
  resolvedModel = "llama-3.1-8b-instant";
  return resolvedModel;
}

export async function generateFormData({
  language,
  hint,
  persona,
  pageContext,
  fields,
}) {
  const model = await getWorkingModel();
  const isSingleField = fields.length === 1;

  const systemPrompt = isSingleField ? SYSTEM_PROMPT_FAST : SYSTEM_PROMPT;
  const maxTokens = isSingleField ? 120 : 1024;

  const userPayload = isSingleField
    ? {
        language: language || "en",
        field: {
          key: fields[0].key,
          label: fields[0].label,
          type: fields[0].type,
          tag: fields[0].tag,
          placeholder: fields[0].placeholder || undefined,
          options: fields[0].options?.slice(0, 20),
        },
      }
    : {
        language: language || "en",
        hint: hint || null,
        persona: persona || null,
        pageContext,
        fields: fields.map(
          ({
            key,
            tag,
            type,
            label,
            placeholder,
            name,
            autocomplete,
            required,
            maxLength,
            min,
            max,
            pattern,
            options,
          }) => ({
            key,
            tag,
            type,
            label,
            placeholder,
            name,
            autocomplete,
            required,
            maxLength,
            min,
            max,
            pattern,
            options: Array.isArray(options) ? options.slice(0, 40) : undefined,
          }),
        ),
      };

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.7,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
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
