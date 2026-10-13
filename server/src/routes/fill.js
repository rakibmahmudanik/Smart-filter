import crypto from "crypto";
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { validateFillPayload } from "../middleware/validate.js";
import { generateFormData } from "../services/groq.js";

export const fillRouter = Router();

// Lightweight LRU In-Memory Cache (Stores last 50 identical queries for 1 minute to save tokens)
const responseCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute
const MAX_CACHE_ENTRIES = 50;

function generateCacheKey(data) {
  const keyBasis = {
    lang: data.language,
    hint: data.hint || "",
    personaId: data.persona?.id || "",
    fields: data.fields.map((f) => `${f.key}:${f.label}:${f.type}`),
  };
  return crypto
    .createHash("md5")
    .update(JSON.stringify(keyBasis))
    .digest("hex");
}

fillRouter.post(
  "/",
  authenticateToken,
  validateFillPayload,
  async (req, res) => {
    const startTime = Date.now();
    const isSingleField = req.validatedData.fields.length === 1;
    const cacheKey = isSingleField
      ? null
      : generateCacheKey(req.validatedData);

    // 1. Instant Cache Hit within 1 minute for multi-field forms (0 Tokens, ~1ms response)
    if (!isSingleField && cacheKey) {
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        console.log(
          `[CACHE HIT - 1m] Fields: ${req.validatedData.fields.length} | Time: ${Date.now() - startTime}ms | Tokens: 0`,
        );
        return res.json({ values: cached.values, cached: true });
      }
    }

    try {
      // 2. Fetch AI Generated Data (after 1 minute, on new form, or on single-field)
      const result = await generateFormData(req.validatedData);
      const duration = Date.now() - startTime;

      console.log(
        `[FILL SUCCESS] Fields: ${req.validatedData.fields.length} | Time: ${duration}ms | Tokens: ${result.usage?.total_tokens || 0}`,
      );

      // Save multi-field forms to 1-minute cache
      if (!isSingleField && cacheKey) {
        if (responseCache.size >= MAX_CACHE_ENTRIES) {
          const firstKey = responseCache.keys().next().value;
          responseCache.delete(firstKey);
        }
        responseCache.set(cacheKey, {
          values: result.values,
          timestamp: Date.now(),
        });
      }

      return res.json({
        values: result.values,
        usage: result.usage,
      });
    } catch (error) {
      console.error(`[FILL ERROR] ${error.message}`);
      return res
        .status(502)
        .json({ error: error.message || "AI service generation failed." });
    }
  },
);
