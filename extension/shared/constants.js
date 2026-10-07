// Shared constants (API URL, storage keys, defaults)
export const STORAGE_KEYS = {
  OPERATING_MODE: "smartfill_mode",
  SERVER_URL: "smartfill_server_url",
  EXTENSION_TOKEN: "smartfill_token",
  DIRECT_API_KEY: "smartfill_direct_key",
  DIRECT_MODEL: "smartfill_direct_model",
  DEFAULT_LANGUAGE: "smartfill_lang",
  SAVED_PERSONAS: "smartfill_personas",
  SELECTED_PERSONA_ID: "smartfill_selected_persona",
  FILL_SCOPE: "smartfill_scope",
  LAST_HINT: "smartfill_last_hint",
  FIRST_RUN_NOTICED: "smartfill_first_run_ok",
};

export const DEFAULT_CONFIG = {
  OPERATING_MODE: "proxy_mode",
  SERVER_URL: "http://localhost:3000",
  EXTENSION_TOKEN: "smartfill_secure_token_replace_with_random_string",
  DIRECT_MODEL: "llama-3.1-8b-instant",
  DEFAULT_LANGUAGE: "en",
  FILL_SCOPE: "empty_only",
};

export const MESSAGE_TYPES = {
  SCAN_FORM: "SCAN_FORM",
  SCAN_RESULT: "SCAN_RESULT",
  GET_FILL_DATA: "GET_FILL_DATA",
  FILL_DATA: "FILL_DATA",
  APPLY_FILL: "APPLY_FILL",
  APPLY_RESULT: "APPLY_RESULT",
  UNDO_FILL: "UNDO_FILL",
  UNDO_RESULT: "UNDO_RESULT",
};
