// Request validation middleware
import { z } from "zod";

const optionSchema = z.object({
  value: z.string(),
  text: z.string().optional(),
});

const fieldSchema = z.object({
  key: z.string(),
  tag: z.enum(["input", "textarea", "select"]),
  type: z.string(),
  label: z.string(),
  placeholder: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  id: z.string().optional().nullable(),
  autocomplete: z.string().optional().nullable(),
  required: z.boolean().optional(),
  maxLength: z.number().optional().nullable(),
  min: z.string().optional().nullable(),
  max: z.string().optional().nullable(),
  pattern: z.string().optional().nullable(),
  options: z.array(optionSchema).optional().nullable(),
});

const fillRequestSchema = z.object({
  language: z.enum(["en", "bn"]).default("en"),
  hint: z.string().max(300).optional().nullable(),
  persona: z.record(z.any()).optional().nullable(),
  pageContext: z.object({
    title: z.string(),
    hostname: z.string(),
    heading: z.string().optional().nullable(),
    formAction: z.string().optional().nullable(),
    formIdOrClass: z.string().optional().nullable(),
  }),
  fields: z.array(fieldSchema).min(1).max(60),
});

export function validateFillPayload(req, res, next) {
  const result = fillRequestSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: "Invalid request body structure",
      details: result.error.errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`,
      ),
    });
  }
  req.validatedData = result.data;
  next();
}
