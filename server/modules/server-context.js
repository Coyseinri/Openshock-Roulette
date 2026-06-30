function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

function getPublicBaseUrl(req) {
  CONFIG = readConfig();
  const configured = String(CONFIG.server?.publicBaseUrl || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const host = req.headers.host || `localhost:${PORT}`;
  const lan = getLanAddresses()[0];
  if (lan) {
    const port = String(host).includes(":") ? String(host).split(":").pop() : PORT;
    return `http://${lan}:${port}`;
  }
  return `http://${host}`;
}

function isLocalRequest(req) {
  const addr = String(req.socket.remoteAddress || "");
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr === "localhost";
}

function pageEnabledFromConfig(cfg, defaultEnabled = true) {
  const enabled = Boolean(cfg.enabled ?? cfg.qrCodesEnabled ?? defaultEnabled);
  return { enabled, qrCodesEnabled: enabled };
}

function playerPagesConfig() {
  CONFIG = readConfig();
  const cfg = CONFIG.playerPages || {};
  const page = pageEnabledFromConfig(cfg, true);
  return {
    enabled: page.enabled,
    qrCodesEnabled: page.qrCodesEnabled,
    autoRefreshMs: clampInt(cfg.autoRefreshMs ?? 2000, 500, 30000),
    useShockerIdAsAccessKey: Boolean(cfg.useShockerIdAsAccessKey ?? false)
  };
}

function economyConfig() {
  CONFIG = readConfig();
  const cfg = CONFIG.economy || {};
  const tokenCosts = {
    shield: clampInt(cfg.tokenCosts?.shield ?? cfg.shieldTokenCost ?? cfg.shieldCost ?? 8, 0, 999),
    mercy: clampInt(cfg.tokenCosts?.mercy ?? cfg.mercyTokenCost ?? cfg.mercyCost ?? 6, 0, 999),
    blessing: clampInt(cfg.tokenCosts?.blessing ?? cfg.blessingTokenCost ?? cfg.blessingCost ?? 5, 0, 999),
    curse: clampInt(cfg.tokenCosts?.curse ?? cfg.curseTokenCost ?? cfg.curseCost ?? 5, 0, 999),
    chaos: clampInt(cfg.tokenCosts?.chaos ?? cfg.chaosTokenCost ?? 10, 0, 999),
    guarantee: clampInt(cfg.tokenCosts?.guarantee ?? cfg.guaranteeTokenCost ?? cfg.guaranteedPickCost ?? 12, 0, 999),
    immunity: clampInt(cfg.tokenCosts?.immunity ?? cfg.immunityTokenCost ?? 10, 0, 999),
    doubleShock: clampInt(cfg.tokenCosts?.doubleShock ?? cfg.doubleShockTokenCost ?? 10, 0, 999)
  };
  return {
    objectiveRewardPoints: clampInt(cfg.objectiveRewardPoints ?? 3, 0, 999),
    bodyguardRewardPoints: clampInt(cfg.bodyguardRewardPoints ?? 2, 0, 999),
    blessingCost: clampInt(cfg.blessingCost ?? tokenCosts.blessing, 0, 999),
    curseCost: clampInt(cfg.curseCost ?? tokenCosts.curse, 0, 999),
    shieldCost: clampInt(cfg.shieldCost ?? tokenCosts.shield, 0, 999),
    mercyCost: clampInt(cfg.mercyCost ?? tokenCosts.mercy, 0, 999),
    audienceTokenGrantAmount: clampInt(cfg.audienceTokenGrantAmount ?? 1, 1, 20),
    audienceVoteThreshold: clampInt(cfg.audienceVoteThreshold ?? 3, 1, 1000),
    audienceCooldownSeconds: clampInt(cfg.audienceCooldownSeconds ?? 20, 0, 3600),
    audienceMaxVotesPerRound: clampInt(cfg.audienceMaxVotesPerRound ?? 1, 1, 100),
    hostDefaultPointDonation: clampInt(cfg.hostDefaultPointDonation ?? 1, 0, 999),
    hostDefaultTokenDonationAmount: clampInt(cfg.hostDefaultTokenDonationAmount ?? 1, 1, 99),
    tokenTypes: ["shield", "mercy", "blessing", "curse", "chaos", "guarantee", "immunity", "doubleShock"],
    tokenCosts
  };
}

function normalizeTokenType(tokenType) {
  const raw = String(tokenType || "").trim();
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  const aliases = {
    shield: "shield",
    mercy: "mercy",
    blessing: "blessing",
    bless: "blessing",
    curse: "curse",
    chaos: "chaos",
    guarantee: "guarantee",
    guaranteedpick: "guarantee",
    immunity: "immunity",
    immune: "immunity",
    doubleshock: "doubleShock",
    forceddoubleshock: "doubleShock",
    doubledshock: "doubleShock"
  };
  const canonical = aliases[key] || raw;
  return economyConfig().tokenTypes.includes(canonical) ? canonical : null;
}

