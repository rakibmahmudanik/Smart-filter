async function fetchDirectGroq(payload, apiKey, model) {
  if (!apiKey) {
    throw new Error(
      "Groq API Key is missing. Open Settings to configure your key.",
    );
  }

  const isSingleField = payload.fields.length === 1;
  const systemPrompt = isSingleField
    ? 'Generate a realistic mock value for the input in JSON format {"<key>": "<value>"}. No explanations.'
    : DIRECT_SYSTEM_PROMPT;

  const userContent = JSON.stringify(
    isSingleField
      ? {
          language: payload.language,
          field: {
            key: payload.fields[0].key,
            label: payload.fields[0].label,
            type: payload.fields[0].type,
            options: payload.fields[0].options?.slice(0, 20),
          },
        }
      : payload,
  );

  const response = await fetch(DIRECT_GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "llama3-8b-8192",
      temperature: 0.7,
      max_tokens: isSingleField ? 120 : 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      err.error?.message ||
        `Groq API responded with error status ${response.status}`,
    );
  }

  const data = await response.json();
  const rawText = data.choices[0]?.message?.content || "{}";
  return JSON.parse(rawText);
}
