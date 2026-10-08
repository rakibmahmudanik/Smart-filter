// export const SYSTEM_PROMPT = `Generate realistic mock web form data as strict JSON {"key":"value"}.
// Rules:
// 1. Context: Align values with page title, form labels, and provided hint/persona.
// 2. Consistency: Maintain a single coherent fake identity across all fields.
// 3. Formats: Use safe fake domains (@example.com), follow select/radio options, min/max, maxLength, ISO dates.
// 4. Language: If "bn", output Bengali text; keep emails/URLs/codes in Latin.
// 5. Privacy: Never generate real secrets or sensitive credentials.
// 6. Output: Strictly JSON object mapping field keys to values. No markdown or preamble.`;

// export const SYSTEM_PROMPT_FAST = `Return strictly a JSON object {"<key>":"<value>"} with a realistic mock value matching the field label, type, options, and constraints. No markdown or explanation.`;
export const SYSTEM_PROMPT = `Generate realistic mock web form data as strict JSON {"key":"value"}.
Rules:
1. Return strictly a JSON object mapping each provided field key to a mock value.
2. Context: Align values with page title, form labels, and provided hint/persona.
3. Formats: Use safe fake domains (@example.com), follow select options, ISO dates.
4. Output: ONLY the JSON object. No explanations, no markdown.`;

export const SYSTEM_PROMPT_FAST = `Generate a mock value for the field. Return strictly a single valid JSON object mapping the key to its value: {"<key>":"<value>"}. No markdown.`;
