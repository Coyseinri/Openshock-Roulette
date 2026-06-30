// Extracted from server/app.js. Loaded by server/app.js in order.
function validateEventCards(data) {
  if (!data || typeof data !== "object") throw new Error("Event cards config must be an object");
  data.enabled = Boolean(data.enabled ?? true);
  data.chancePercent = clampInt(data.chancePercent ?? 45, 0, 100);
  data.displayDurationMs = clampInt(data.displayDurationMs ?? 7000, 0, 15000);
  if (!Array.isArray(data.cards)) data.cards = [];

  data.cards = data.cards.map((card, i) => {
    if (!card || typeof card !== "object") throw new Error(`event card ${i} must be an object`);
    if (!card.id) throw new Error(`event card ${i} needs id`);
    card.id = String(card.id);
    card.title = String(card.title || card.id);
    card.description = String(card.description || card.text || "");
    card.enabled = Boolean(card.enabled ?? true);
    card.weight = clampInt(card.weight ?? 1, 0, 1000);
    if (card.effects !== undefined && !Array.isArray(card.effects)) throw new Error(`event card ${card.id} effects must be an array`);
    if (!Array.isArray(card.effects)) card.effects = card.type ? [{ type: String(card.type) }] : [];
    card.effects = card.effects.map(effect => ({ ...effect, type: String(effect.type || "") })).filter(effect => effect.type);
    card.targetWheel = Boolean(card.targetWheel ?? false);
    card.fateWheel = Boolean(card.fateWheel ?? false);
    return card;
  });

  return data;
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object");
  if (!Array.isArray(config.fateWheel)) throw new Error("config.fateWheel must be an array");
  if (!config.fateWheel.length) throw new Error("config.fateWheel must not be empty");
  config.eventCards = config.eventCards || {};
  config.eventCards.enabled = Boolean(config.eventCards.enabled ?? true);
  config.eventCards.chancePercent = clampInt(config.eventCards.chancePercent ?? 45, 0, 100);
  config.eventCards.displayDurationMs = clampInt(config.eventCards.displayDurationMs ?? 7000, 0, 15000);
  config.playerPages = config.playerPages || {};
  {
    const page = pageEnabledFromConfig(config.playerPages, true);
    config.playerPages.enabled = page.enabled;
    delete config.playerPages.qrCodesEnabled;
  }
  config.playerPages.autoRefreshMs = clampInt(config.playerPages.autoRefreshMs ?? 2000, 500, 30000);
  config.playerPages.useShockerIdAsAccessKey = Boolean(config.playerPages.useShockerIdAsAccessKey ?? false);
  config.hostPage = config.hostPage || {};
  {
    const page = pageEnabledFromConfig(config.hostPage, true);
    config.hostPage.enabled = page.enabled;
    delete config.hostPage.qrCodesEnabled;
  }
  delete config.hostPage.accessKey;
  config.hostPage.autoRefreshMs = clampInt(config.hostPage.autoRefreshMs ?? 1500, 500, 30000);
  config.hostPage.allowManualControl = true;
  config.audiencePage = config.audiencePage || {};
  {
    const page = pageEnabledFromConfig(config.audiencePage, true);
    config.audiencePage.enabled = page.enabled;
    delete config.audiencePage.qrCodesEnabled;
  }
  delete config.audiencePage.accessKey;
  config.audiencePage.autoRefreshMs = clampInt(config.audiencePage.autoRefreshMs ?? 2500, 500, 30000);
  config.audiencePage.requireUniqueSession = Boolean(config.audiencePage.requireUniqueSession ?? true);
  config.server = config.server || {};
  config.server.host = String(config.server.host || "0.0.0.0");
  config.server.publicBaseUrl = String(config.server.publicBaseUrl || "");
  config.server.adminLocalhostOnly = Boolean(config.server.adminLocalhostOnly ?? true);
  config.economy = config.economy || {};
  config.economy.objectiveRewardPoints = clampInt(config.economy.objectiveRewardPoints ?? 3, 0, 999);
  config.economy.bodyguardRewardPoints = clampInt(config.economy.bodyguardRewardPoints ?? 2, 0, 999);
  config.economy.blessingCost = clampInt(config.economy.blessingCost ?? 5, 0, 999);
  config.economy.curseCost = clampInt(config.economy.curseCost ?? 5, 0, 999);
  config.economy.shieldCost = clampInt(config.economy.shieldCost ?? 8, 0, 999);
  config.economy.mercyCost = clampInt(config.economy.mercyCost ?? 6, 0, 999);
  config.economy.audienceTokenGrantAmount = clampInt(config.economy.audienceTokenGrantAmount ?? 1, 1, 20);
  config.economy.audienceVoteThreshold = clampInt(config.economy.audienceVoteThreshold ?? 3, 1, 1000);
  config.economy.audienceCooldownSeconds = clampInt(config.economy.audienceCooldownSeconds ?? 20, 0, 3600);
  config.economy.audienceMaxVotesPerRound = clampInt(config.economy.audienceMaxVotesPerRound ?? 1, 1, 100);
  config.economy.hostDefaultPointDonation = clampInt(config.economy.hostDefaultPointDonation ?? 1, 0, 999);
  config.economy.hostDefaultTokenDonationAmount = clampInt(config.economy.hostDefaultTokenDonationAmount ?? 1, 1, 99);
  config.economy.tokenCosts = config.economy.tokenCosts || {};
  config.economy.tokenCosts.shield = clampInt(config.economy.tokenCosts.shield ?? config.economy.shieldCost ?? 8, 0, 999);
  config.economy.tokenCosts.mercy = clampInt(config.economy.tokenCosts.mercy ?? config.economy.mercyCost ?? 6, 0, 999);
  config.economy.tokenCosts.blessing = clampInt(config.economy.tokenCosts.blessing ?? config.economy.blessingCost ?? 5, 0, 999);
  config.economy.tokenCosts.curse = clampInt(config.economy.tokenCosts.curse ?? config.economy.curseCost ?? 5, 0, 999);
  config.economy.tokenCosts.chaos = clampInt(config.economy.tokenCosts.chaos ?? 10, 0, 999);
  config.economy.tokenCosts.guarantee = clampInt(config.economy.tokenCosts.guarantee ?? config.economy.guaranteeTokenCost ?? config.economy.guaranteedPickCost ?? 12, 0, 999);
  config.economy.tokenCosts.immunity = clampInt(config.economy.tokenCosts.immunity ?? config.economy.immunityTokenCost ?? 10, 0, 999);
  config.economy.tokenCosts.doubleShock = clampInt(config.economy.tokenCosts.doubleShock ?? config.economy.doubleShockTokenCost ?? 10, 0, 999);

  const maxShock = clampInt(config.safety?.serverMaxShockIntensity ?? 99, 1, 100);

  config.fateWheel.forEach((f, i) => {
    if (!f.key || !f.name) throw new Error(`fateWheel[${i}] needs key and name`);
    f.min = clampInt(f.min, 0, maxShock);
    f.max = clampInt(f.max, 0, maxShock);
    if (f.max < f.min) [f.min, f.max] = [f.max, f.min];
    f.weight = clampInt(f.weight, 0, 1000);
    f.enabled = Boolean(f.enabled ?? true);
    if (!["down", "neutral", "up"].includes(f.escalates)) f.escalates = "neutral";
  });

  return config;
}
