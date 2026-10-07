// Auth middleware: checks access key header
import crypto from "node:crypto";

export function authenticateToken(req, res, next) {
  const clientToken = req.headers["x-extension-token"];
  const expectedToken = process.env.EXTENSION_TOKEN;

  if (!expectedToken) {
    console.error("[AUTH ERROR] EXTENSION_TOKEN is not configured on server.");
    return res
      .status(500)
      .json({ error: "Server authentication misconfigured." });
  }

  if (!clientToken || typeof clientToken !== "string") {
    return res
      .status(401)
      .json({ error: "Missing or malformed X-Extension-Token header." });
  }

  const clientBuffer = Buffer.from(clientToken);
  const expectedBuffer = Buffer.from(expectedToken);

  if (
    clientBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(clientBuffer, expectedBuffer)
  ) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Invalid extension token." });
  }

  next();
}
