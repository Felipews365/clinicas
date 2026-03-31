const { HttpError } = require("../lib/http-error");

function sanitizeUrl(value) {
  if (!value) return null;
  return String(value).replace(/\/$/, "");
}

function validateEvolutionEnv() {
  const env = {
    EVOLUTION_API_URL: sanitizeUrl(process.env.EVOLUTION_API_URL),
    EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY || null,
    EVOLUTION_WEBHOOK_URL: sanitizeUrl(process.env.EVOLUTION_WEBHOOK_URL),
    EVOLUTION_WEBHOOK_SECRET: process.env.EVOLUTION_WEBHOOK_SECRET || null,
    N8N_WEBHOOK_URL: sanitizeUrl(process.env.N8N_WEBHOOK_URL || process.env.EVOLUTION_FORWARD_WEBHOOK_URL),
  };

  const required = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_WEBHOOK_URL"];
  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new HttpError(
      503,
      "MISSING_SERVER_CONFIG",
      `Variável de ambiente ausente: ${missing.join(", ")}`,
      { missing }
    );
  }

  return env;
}

module.exports = {
  validateEvolutionEnv,
};
