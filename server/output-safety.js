function normalizeSafety(input = {}) {
  const integer = (value, fallback, min, max) => {
    const n = Number(value ?? fallback);
    return Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : fallback)));
  };
  const minDurationMs = integer(input.minDurationMs, 300, 1, 30000);
  const maxDurationMs = integer(input.maxDurationMs, 1000, minDurationMs, 30000);
  return {
    ...input,
    serverMaxShockIntensity: integer(input.serverMaxShockIntensity, 99, 1, 99),
    serverMaxVibrateIntensity: integer(input.serverMaxVibrateIntensity, 100, 1, 100),
    minDurationMs, maxDurationMs,
    defaultDurationMs: integer(input.defaultDurationMs, 700, minDurationMs, maxDurationMs)
  };
}

module.exports = { normalizeSafety };
