import dotenv from "dotenv";
dotenv.config();

import Groq from "groq-sdk";
import { SYSTEM_PROMPT } from "../prompts/systemPrompt.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

let resolvedModel = null;

// Groq এর অ্যাকাউন্ট থেকে রিয়েলটাইমে ভ্যালিড মডেল খুঁজে বের করার ফাংশন
async function getWorkingModel() {
  if (resolvedModel) return resolvedModel;

  try {
    const modelList = await groq.models.list();
    const activeModels = modelList.data.map((m) => m.id);
    console.log("[Smart Filler] Groq Available Models:", activeModels);

    // অগ্রাধিকার অনুযায়ী মডেল চেক করা
    const candidates = [
      "llama-3.1-8b-instant",
      "llama3-8b-8192",
      "llama3-70b-8192",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ];

    for (const cand of candidates) {
      if (activeModels.includes(cand)) {
        resolvedModel = cand;
        console.log(`[Smart Filler] Active model selected: ${resolvedModel}`);
        return resolvedModel;
      }
    }

    // যদি লিস্টের কোনোটার সাথে না মেলে, যেকোনো টেক্সট/চ্যাট মডেল পিক করবে (audio/whisper বাদে)
    const anyChatModel = activeModels.find(
      (id) =>
        !id.includes("whisper") &&
        !id.includes("guard") &&
        !id.includes("distil") &&
        !id.includes("vision"),
    );

    if (anyChatModel) {
      resolvedModel = anyChatModel;
      console.log(
        `[Smart Filler] Auto fallback model selected: ${resolvedModel}`,
      );
      return resolvedModel;
    }
  } catch (err) {
    console.error(
      "[Smart Filler] Failed to fetch model list from Groq:",
      err.message,
    );
  }

  // একদম শেষ ব্যাকআপ
  resolvedModel = "llama3-8b-8192";
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

  const userPayload = {
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
    max_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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
