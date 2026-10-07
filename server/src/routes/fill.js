import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { validateFillPayload } from "../middleware/validate.js";
import { generateFormData } from "../services/groq.js";

export const fillRouter = Router();

fillRouter.post(
  "/",
  authenticateToken,
  validateFillPayload,
  async (req, res) => {
    const startTime = Date.now();
    try {
      const result = await generateFormData(req.validatedData);
      const duration = Date.now() - startTime;
      console.log(
        `[FILL SUCCESS] Fields: ${req.validatedData.fields.length} | Time: ${duration}ms | Tokens: ${result.usage.total_tokens || 0}`,
      );
      return res.json(result);
    } catch (error) {
      console.error(`[FILL ERROR] ${error.message}`);
      return res
        .status(502)
        .json({ error: error.message || "AI service generation failed." });
    }
  },
);
