function restoreOriginalFateWheel(fateWheel) {
  const original = [
    { key: "vibe", name: "Vibe", min: 0, max: 0, weight: 32, enabled: true, escalates: "down" },
    { key: "warmup", name: "Warmup", min: 1, max: 15, weight: 32, enabled: true, escalates: "down" },
    { key: "low", name: "Low", min: 16, max: 35, weight: 24, enabled: true, escalates: "neutral" },
    { key: "medium", name: "Medium", min: 36, max: 60, weight: 16, enabled: true, escalates: "up" },
    { key: "high", name: "High", min: 61, max: 75, weight: 8, enabled: true, escalates: "up" },
    { key: "brutal", name: "Brutal", min: 76, max: 90, weight: 3, enabled: true, escalates: "up" },
    { key: "deathwish", name: "Deathwish", min: 91, max: 99, weight: 1, enabled: true, escalates: "up" }
  ];
  const incoming = Array.isArray(fateWheel) ? fateWheel : [];
  if (!incoming.length) return original;
  const byKey = new Map();
  for (const item of incoming) {
    if (!item || typeof item !== "object") continue;
    let key = String(item.key || item.name || "").trim().toLowerCase();
    if (key === "light") key = "low";
    if (key) byKey.set(key, item);
  }
  return original.map(def => {
    const current = byKey.get(def.key) || {};
    return {
      ...def,
      ...current,
      key: def.key,
      name: def.name,
      min: current.min ?? def.min,
      max: current.max ?? def.max,
      weight: current.weight ?? def.weight,
      enabled: current.enabled ?? def.enabled,
      escalates: current.escalates ?? def.escalates
    };
  });
}

function normalizeConfigForRuntime(input) {
  const src = input && typeof input === "object" ? input : {};
  const spinners = src.spinners || {};
  const pages = src.pages || {};
  const devices = src.devices || {};

  const runtime = { ...src };
  runtime.version = APP_VERSION;
  runtime.server = { ...(src.server || {}) };
  runtime.app = { ...(src.app || {}) };
  runtime.safety = { ...(src.safety || {}) };
  runtime.keyboard = { ...(src.keyboard || {}) };
  runtime.game = { ...(src.game || {}) };
  runtime.ui = { ...(src.ui || {}) };
  runtime.economy = { ...(src.economy || {}) };
  runtime.eventCards = { ...(src.eventCards || src.events?.eventCards || {}) };

  runtime.targetWheel = { ...(src.targetWheel || spinners.targetWheel || spinners.target || {}) };
  if (runtime.targetWheel.shockAllWeight === undefined && runtime.targetWheel.allWeight !== undefined) runtime.targetWheel.shockAllWeight = runtime.targetWheel.allWeight;
  delete runtime.targetWheel.allWeight;
  if (runtime.game.hiddenDoubleHitChancePercent === undefined && runtime.targetWheel.doubleHitChance !== undefined) runtime.game.hiddenDoubleHitChancePercent = runtime.targetWheel.doubleHitChance;
  delete runtime.targetWheel.doubleHitChance;

  runtime.fateWheel = Array.isArray(src.fateWheel)
    ? src.fateWheel
    : Array.isArray(spinners.fateWheel)
      ? spinners.fateWheel
      : Array.isArray(spinners.fate)
        ? spinners.fate
        : [];
  runtime.fateWheel = restoreOriginalFateWheel(runtime.fateWheel);

  runtime.playerPages = { ...(src.playerPages || pages.player || {}) };
  runtime.hostPage = { ...(src.hostPage || pages.host || {}) };
  runtime.audiencePage = { ...(src.audiencePage || pages.audience || {}) };
  runtime.shockers = { ...(src.shockers || devices.shockers || {}) };

  if (src.api?.openshock) {
    runtime.server.apiHost = runtime.server.apiHost || src.api.openshock.host;
    runtime.server.userAgent = runtime.server.userAgent || src.api.openshock.userAgent;
  }

  if (!runtime.server.userAgent || /^OpenShock-Roulette\/\d+\.\d+\.\d+ \(local-party-game\)$/.test(String(runtime.server.userAgent))) runtime.server.userAgent = APP_USER_AGENT;
  return runtime;
}

function configForDisk(config) {
  const runtime = validateConfig(normalizeConfigForRuntime(config));
  return {
    version: APP_VERSION,
    app: runtime.app || {},
    server: runtime.server || {},
    api: { openshock: { host: runtime.server?.apiHost || "api.openshock.app", userAgent: runtime.server?.userAgent || APP_USER_AGENT } },
    safety: runtime.safety || {},
    keyboard: runtime.keyboard || {},
    spinners: { target: runtime.targetWheel || {}, fate: runtime.fateWheel || [] },
    game: runtime.game || {},
    events: { eventCards: runtime.eventCards || {} },
    pages: { player: runtime.playerPages || {}, host: runtime.hostPage || {}, audience: runtime.audiencePage || {} },
    economy: runtime.economy || {},
    ui: runtime.ui || {},
    devices: { shockers: runtime.shockers || {} }
  };
}

var configCache = null;
var configCacheMtimeMs = 0;
function invalidateConfigCache() { configCache = null; configCacheMtimeMs = 0; }

function readConfig() {
  ensureLocalFilesFromExamples();
  const source = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : CONFIG_EXAMPLE_PATH;
  const mtimeMs = fs.existsSync(source) ? fs.statSync(source).mtimeMs : 0;
  if (configCache && configCacheMtimeMs === mtimeMs) return configCache;
  const fallback = fs.existsSync(source) ? JSON.parse(fs.readFileSync(source, "utf8")) : { fateWheel: restoreOriginalFateWheel([]) };
  configCache = validateConfig(normalizeConfigForRuntime(fallback));
  configCacheMtimeMs = mtimeMs;
  return configCache;
}

function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const validated = validateConfig(config);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configForDisk(validated), null, 2), "utf8");
  invalidateConfigCache();
}

function resetGameConfigToDefaults() {
  const fallback = fs.existsSync(CONFIG_EXAMPLE_PATH) ? JSON.parse(fs.readFileSync(CONFIG_EXAMPLE_PATH, "utf8")) : { fateWheel: restoreOriginalFateWheel([]) };
  const validated = validateConfig(normalizeConfigForRuntime(fallback));
  writeConfig(validated);
  invalidateConfigCache();
  return validated;
}

function readEventCards() {
  ensureLocalFilesFromExamples();
  const source = fs.existsSync(EVENT_CARDS_PATH) ? EVENT_CARDS_PATH : EVENT_CARDS_EXAMPLE_PATH;
  const raw = fs.existsSync(source) ? JSON.parse(fs.readFileSync(source, "utf8")) : { enabled: true, chancePercent: 45, displayDurationMs: 10000, cards: [] };
  return validateEventCards(raw);
}

var CONFIG = readConfig();
var PORT = process.env.PORT || CONFIG.server?.port || 8787;
var TOKEN = process.env["OPENSHOCK_" + "TOKEN"] || process.env["OPENSHOCK_API_" + "TOKEN"] || "";
var API_HOST = process.env.OPENSHOCK_API_HOST || CONFIG.server?.apiHost || "api.openshock.app";
var USER_AGENT = process.env.OPENSHOCK_USER_AGENT || CONFIG.server?.userAgent || APP_USER_AGENT;
