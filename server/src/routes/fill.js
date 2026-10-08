import crypto from "crypto";
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { validateFillPayload } from "../middleware/validate.js";
import { generateFormData } from "../services/groq.js";

export const fillRouter = Router();

// Lightweight LRU In-Memory Cache (Stores last 50 identical queries for 5 minutes)
const responseCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

function generateCacheKey(data) {
  // Create deterministic hash from relevant prompt fields
  const keyBasis = {
    lang: data.language,
    hint: data.hint,
    personaId: data.persona?.id,
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
    const cacheKey = generateCacheKey(req.validatedData);
    const cached = responseCache.get(cacheKey);

    // 1. Instant Cache Hit (0 Tokens, ~1-2ms response)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(
        `[CACHE HIT] Fields: ${req.validatedData.fields.length} | Time: ${Date.now() - startTime}ms | Tokens: 0`,
      );
      return res.json({ values: cached.values, cached: true });
    }

    try {
      // 2. Fetch AI Generated Data
      const result = await generateFormData(req.validatedData);
      const duration = Date.now() - startTime;

      console.log(
        `[FILL SUCCESS] Fields: ${req.validatedData.fields.length} | Time: ${duration}ms | Tokens: ${result.usage?.total_tokens || 0}`,
      );

      // Save to cache
      if (responseCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = responseCache.keys().next().value;
        responseCache.delete(firstKey);
      }
      responseCache.set(cacheKey, {
        values: result.values,
        timestamp: Date.now(),
      });

      // Return only what extension actually consumes
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
