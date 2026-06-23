// OSR frontend UI helpers

function log(msg) {
  const el = document.getElementById("log");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + el.textContent;
}

function setMainResult(text, cls="") {
  mainResult.className = "bigResult " + cls;
  mainResult.textContent = text;
}

function updateEventCardPanel(card, stateText = null) {
  const panel = document.getElementById("eventCardPanel");
  const title = document.getElementById("eventCardTitle");
  const description = document.getElementById("eventCardDescription");

  if (!panel || !title || !description) return;

  if (!card) {
    panel.className = "eventCardPanel none";
    title.textContent = "No Event Card";
    description.textContent = stateText || "Waiting for the next event roll...";
    return;
  }

  const category = normalizeEventCategory(card);
  panel.className = `eventCardPanel ${category}`;
  title.textContent = card.title || card.name || card.id || "Event Card";
  description.textContent = card.description || card.text || card.effect || "No description provided.";
}

function syncPageQrControls() {
  // Page and QR settings are consolidated. QR follows the page setting.
}

function applyConfigToForm() {
  document.getElementById("playerWeight").value = config.targetWheel?.playerWeight ?? 100;
  document.getElementById("safeWeight").value = config.targetWheel?.safeWeight ?? 10;
  document.getElementById("shockAllWeight").value = config.targetWheel?.shockAllWeight ?? 5;

  document.getElementById("doubleHitChance").value = config.game?.hiddenDoubleHitChancePercent ?? 5;
  document.getElementById("pauseMinMs").value = config.game?.pauseBeforeFateMinMs ?? 1500;
  document.getElementById("pauseMaxMs").value = config.game?.pauseBeforeFateMaxMs ?? 3000;
  document.getElementById("hitDelayMinMs").value = config.game?.preHitDelayMinMs ?? 1000;
  document.getElementById("hitDelayMaxMs").value = config.game?.preHitDelayMaxMs ?? 3000;
  document.getElementById("doubleDelayMinMs").value = config.game?.doubleHitDelayMinMs ?? 700;
  document.getElementById("doubleDelayMaxMs").value = config.game?.doubleHitDelayMaxMs ?? 2500;
  document.getElementById("duration").value = config.safety?.defaultDurationMs ?? 700;

  document.getElementById("noRepeatMode").value = config.game?.noRepeatFate ? "on" : "off";
  document.getElementById("escalationEnabled").value = config.game?.escalationEnabled ? "on" : "off";
  document.getElementById("escalationPerRound").value = config.game?.escalationPerRound ?? 2;
  const effectiveEventCards = {
    enabled: config.eventCards?.enabled ?? eventCardsConfig?.enabled ?? false,
    chancePercent: config.eventCards?.chancePercent ?? eventCardsConfig?.chancePercent ?? 18,
    displayDurationMs: config.eventCards?.displayDurationMs ?? eventCardsConfig?.displayDurationMs ?? 4000
  };

  document.getElementById("eventCardsEnabled").value = effectiveEventCards.enabled ? "on" : "off";
  document.getElementById("eventCardChance").value = effectiveEventCards.chancePercent;
  document.getElementById("eventCardDisplayMs").value = effectiveEventCards.displayDurationMs;

  const playerPages = config.playerPages || {};
  document.getElementById("playerPagesEnabled").value = (playerPages.enabled ?? playerPages.qrCodesEnabled ?? true) ? "on" : "off";
  document.getElementById("playerAutoRefreshMs").value = playerPages.autoRefreshMs ?? 2000;
  const hostPage = config.hostPage || {};
  document.getElementById("hostPageEnabled").value = (hostPage.enabled ?? hostPage.qrCodesEnabled ?? true) ? "on" : "off";
  const audiencePage = config.audiencePage || {};
  document.getElementById("audiencePageEnabled").value = (audiencePage.enabled ?? audiencePage.qrCodesEnabled ?? true) ? "on" : "off";

  const economy = config.economy || {};
  document.getElementById("objectiveRewardPoints").value = economy.objectiveRewardPoints ?? 3;
  document.getElementById("bodyguardRewardPoints").value = economy.bodyguardRewardPoints ?? 2;
  document.getElementById("blessingCost").value = economy.blessingCost ?? 5;
  document.getElementById("curseCost").value = economy.curseCost ?? 5;
  document.getElementById("shieldCost").value = economy.shieldCost ?? 8;
  document.getElementById("mercyCost").value = economy.mercyCost ?? 6;
  document.getElementById("audienceTokenGrantAmount").value = economy.audienceTokenGrantAmount ?? 1;
  document.getElementById("audienceVoteThreshold").value = economy.audienceVoteThreshold ?? 3;
  document.getElementById("audienceCooldownSeconds").value = economy.audienceCooldownSeconds ?? 20;
  document.getElementById("audienceMaxVotesPerRound").value = economy.audienceMaxVotesPerRound ?? 1;
  const tokenCosts = economy.tokenCosts || {};
  document.getElementById("shieldTokenCost").value = tokenCosts.shield ?? economy.shieldCost ?? 8;
  document.getElementById("mercyTokenCost").value = tokenCosts.mercy ?? economy.mercyCost ?? 6;
  document.getElementById("blessingTokenCost").value = tokenCosts.blessing ?? economy.blessingCost ?? 5;
  document.getElementById("curseTokenCost").value = tokenCosts.curse ?? economy.curseCost ?? 5;
  document.getElementById("chaosTokenCost").value = tokenCosts.chaos ?? 10;
  document.getElementById("guaranteeTokenCost").value = tokenCosts.guarantee ?? economy.guaranteeTokenCost ?? economy.guaranteedPickCost ?? 12;
  document.getElementById("immunityTokenCost").value = tokenCosts.immunity ?? economy.immunityTokenCost ?? 10;
  document.getElementById("doubleShockTokenCost").value = tokenCosts.doubleShock ?? economy.doubleShockTokenCost ?? 10;
}

async function loadPlayerObjectivePanel() {
  const panel = document.getElementById("objectivePanelBody");
  if (!panel) return;
  try {
    const [linksRes, roleLinksRes, objectivesRes] = await Promise.all([
      fetch("/api/player-links"),
      fetch("/api/role-links"),
      fetch("/api/objectives")
    ]);
    const linksData = await linksRes.json();
    const roleLinksData = await roleLinksRes.json();
    const objectivesData = await objectivesRes.json();
    if (!linksRes.ok) throw new Error(linksData.error || "Could not load player links");
    if (!roleLinksRes.ok) throw new Error(roleLinksData.error || "Could not load host/audience links");
    if (!objectivesRes.ok) throw new Error(objectivesData.error || "Could not load objectives");

    const session = objectivesData.session || {};
    const assignments = session.objectiveAssignments || {};
    const defs = new Map((objectivesData.definitions?.objectives || []).map(o => [o.id, o]));
    const points = session.playerPoints || {};
    const tokens = session.playerTokens || {};
    const playerName = id => (linksData.links || []).find(l => String(l.playerId) === String(id))?.name || id || "unknown";
    const pendingMods = session.pendingRoundModifiers || [];
    const audienceVotes = session.audienceVotes || [];
    const objectiveEvents = (session.completedObjectiveEvents || []).filter(e => !e.seen);

    let html = `<div class="objectiveToolbar">
      <button class="secondary" id="refreshObjectivesBtn" type="button">Refresh</button>
      <button class="good" id="generateObjectivesBtn" type="button">Generate / reroll objectives</button>
    </div>`;
    let stateHtml = ``;

    html += `<div class="objectiveNote">Player pages + QR: <strong>${linksData.enabled ? "enabled" : "disabled"}</strong> · Base URL: <code>${escapeHtml(linksData.publicBaseUrl || "")}</code></div>`;

    if (objectiveEvents.length) {
      html += `<h4>Objective completions</h4><div class="pendingActionList">`;
      for (const e of objectiveEvents) {
        html += `<div class="pendingAction objectiveCompletePopup"><strong>${escapeHtml(playerName(e.playerId))}</strong> completed <strong>${escapeHtml(e.title)}</strong> (+${escapeHtml(e.rewardPoints || 0)} pts) <button class="secondary ackObjectiveBtn" type="button" data-id="${escapeHtml(e.id)}">Acknowledge</button></div>`;
      }
      html += `</div>`;
    }

    stateHtml += `<h4>Pending Next Round effects</h4>`;
    if (!pendingMods.length) stateHtml += `<div class="objectiveNote">No pending next-round effects.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const mod of pendingMods) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(mod.type)}</strong> ${mod.targetPlayerId ? `→ ${escapeHtml(playerName(mod.targetPlayerId))}` : ""}${mod.bodyguardPlayerId ? ` · Bodyguard: ${escapeHtml(playerName(mod.bodyguardPlayerId))}` : ""}</div>`;
      }
      stateHtml += `</div>`;
    }

    stateHtml += `<h4>Audience votes</h4>`;
    const openVotes = audienceVotes.filter(v => v.status === "open");
    if (!openVotes.length) stateHtml += `<div class="objectiveNote">No open audience votes.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const vote of openVotes) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(vote.type)}</strong>${vote.tokenType ? ` (${escapeHtml(vote.tokenType)} token)` : ""} → ${escapeHtml(playerName(vote.targetPlayerId))} · Votes: ${escapeHtml(vote.count || 0)}
          <button class="good approveVoteBtn" type="button" data-id="${escapeHtml(vote.id)}">Approve</button>
          <button class="danger rejectVoteBtn" type="button" data-id="${escapeHtml(vote.id)}">Reject</button></div>`;
      }
      stateHtml += `</div>`;
    }
    html += `<h4>Host / audience</h4><div class="playerLinkGrid">`;
    for (const role of ["host", "audience"]) {
      const item = roleLinksData[role];
      if (!item) continue;
      html += `<div class="playerLinkCard">
        <div class="playerLinkHeader"><strong>${role.toUpperCase()}</strong><span>${item.enabled ? "enabled" : "disabled"}</span></div>
        <div class="playerUrl"><input readonly value="${escapeHtml(item.url || "")}"></div>
        ${item.qrDataUrl ? `<img class="qrCode" alt="QR for ${role}" src="${item.qrDataUrl}">` : `<div class="qrDisabled">QR disabled</div>`}
      </div>`;
    }
    html += `</div>`;

    const pending = (session.pendingPlayerActions || []).filter(a => a.status === "pending");
    stateHtml += `<h4>Pending actions</h4>`;
    if (!pending.length) stateHtml += `<div class="objectiveNote">No pending player/audience actions.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const action of pending) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(action.type)}</strong>${action.tokenType ? ` (${escapeHtml(action.tokenType)} token)` : ""} from ${escapeHtml(playerName(action.playerId || action.bodyguardPlayerId) || action.source || "unknown")} ${action.targetPlayerId ? `→ ${escapeHtml(playerName(action.targetPlayerId))}` : ""}
          <button class="good approveActionBtn" type="button" data-id="${escapeHtml(action.id)}">Approve</button>
          <button class="danger rejectActionBtn" type="button" data-id="${escapeHtml(action.id)}">Reject</button>
        </div>`;
      }
      stateHtml += `</div>`;
    }

    stateHtml += `<h4>Session stats</h4>`;
    const sessionStats = (linksData.links || []).map(link => ({ link, stats: session.playerStats?.[link.playerId] || {}, points: Number(points[link.playerId] || 0) }))
      .sort((a, b) => Number(b.stats.shocked || 0) - Number(a.stats.shocked || 0));
    if (!sessionStats.length) stateHtml += `<div class="objectiveNote">No session stats yet.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const item of sessionStats) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(item.link.name)}</strong> · Shocked ${escapeHtml(item.stats.shocked || 0)} · Selected ${escapeHtml(item.stats.selected || 0)} · Vibes ${escapeHtml(item.stats.vibes || 0)} · Points ${escapeHtml(item.points)}</div>`;
      }
      stateHtml += `</div>`;
    }

    html += `<h4>Player links / objectives</h4><div class="playerLinkGrid">`;
    for (const link of linksData.links || []) {
      const list = Array.isArray(assignments[link.playerId]) ? assignments[link.playerId] : [];
      const objectiveText = list.length
        ? list.map(a => {
            const def = defs.get(a.objectiveId);
            const title = def?.title || a.objectiveId;
            return `${escapeHtml(title)}: ${a.progress ?? 0}/${a.target ?? def?.target ?? "?"}${a.completed ? " ✅" : ""}`;
          }).join("<br>")
        : "No objective assigned";
      const tokenText = Object.entries(tokens[link.playerId] || {}).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${escapeHtml(k)} x${escapeHtml(v)}`).join(" · ") || "No tokens";
      const role = session.hiddenRoles?.[link.playerId]?.roleId || "not assigned";
      const multiplier = Number(session.playerMultipliers?.[link.playerId] ?? playerMultipliers?.[link.playerId] ?? 100);
      html += `<div class="playerLinkCard">
        <div class="playerLinkHeader"><strong>${escapeHtml(link.name)}</strong><span>${Number(points[link.playerId] || 0)} pts</span></div>
        <div class="objectiveMini"><strong>Multiplier:</strong> <input class="playerMultiplierInput" type="number" min="0" max="100" step="1" data-player-id="${escapeHtml(link.playerId)}" value="${escapeHtml(Math.max(0, Math.min(100, Math.round(Number.isFinite(multiplier) ? multiplier : 100))))}">%</div>
        <div class="objectiveMini"><strong>Role:</strong> ${escapeHtml(role)}</div>
        <div class="objectiveMini"><strong>Tokens:</strong> ${tokenText}</div>
        <div class="objectiveMini">${objectiveText}</div>
        <div class="playerUrl"><input readonly value="${escapeHtml(link.url)}"></div>
        ${link.qrDataUrl ? `<img class="qrCode" alt="QR for ${escapeHtml(link.name)}" src="${link.qrDataUrl}">` : `<div class="qrDisabled">QR disabled</div>`}
      </div>`;
    }
    html += `</div>`;
    panel.innerHTML = html;
    const gameStatePanel = document.getElementById("gameStatePanelBody");
    if (gameStatePanel) gameStatePanel.innerHTML = stateHtml || `<div class="objectiveNote">No pending state items.</div>`;

    document.querySelectorAll(".playerMultiplierInput").forEach(input => {
      input.addEventListener("change", async () => {
        const id = input.dataset.playerId;
        if (!id) return;
        playerMultipliers[id] = getPlayerMultiplierFromInput(input);
        await savePlayerMultipliers();
        await loadPlayerObjectivePanel();
      });
    });

    document.getElementById("refreshObjectivesBtn")?.addEventListener("click", loadPlayerObjectivePanel);
    document.getElementById("generateObjectivesBtn")?.addEventListener("click", async () => {
      const ok = window.confirm("Generate/reroll secret objectives for all players?");
      if (!ok) return;
      const res = await fetch("/api/objectives/generate", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ resetExisting: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate objectives");
      log("Secret objectives generated.");
      await loadPlayerObjectivePanel();
    });
    document.querySelectorAll(".approveActionBtn,.rejectActionBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const approved = btn.classList.contains("approveActionBtn");
        const res = await fetch("/api/host/action?key=host", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ actionId: btn.dataset.id, approved }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not resolve action");
        log(`Pending action ${approved ? "approved" : "rejected"}.`);
        await loadPlayerObjectivePanel();
      });
    });
    document.querySelectorAll(".approveVoteBtn,.rejectVoteBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const approved = btn.classList.contains("approveVoteBtn");
        const res = await fetch("/api/host/audience-vote?key=host", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ voteId: btn.dataset.id, approved }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not resolve audience vote");
        log(`Audience vote ${approved ? "approved" : "rejected"}.`);
        await loadPlayerObjectivePanel();
      });
    });
    document.querySelectorAll(".ackObjectiveBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const res = await fetch("/api/host/objective-events/ack?key=host", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ids: [btn.dataset.id] }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not acknowledge objective event");
        await loadPlayerObjectivePanel();
      });
    });
  } catch (err) {
    panel.innerHTML = `<div class="warningText">Could not load player/objective panel: ${escapeHtml(err.message)}</div>`;
    const gameStatePanel = document.getElementById("gameStatePanelBody");
    if (gameStatePanel) gameStatePanel.innerHTML = `<div class="warningText">Could not load game state: ${escapeHtml(err.message)}</div>`;
  }
}

function collectFormToConfig() {
  config.targetWheel = config.targetWheel || {};
  config.game = config.game || {};
  config.safety = config.safety || {};
  config.eventCards = config.eventCards || {};

  config.targetWheel.playerWeight = num("playerWeight", 100);
  config.targetWheel.safeWeight = num("safeWeight", 10);
  config.targetWheel.shockAllWeight = num("shockAllWeight", 5);

  config.game.hiddenDoubleHitChancePercent = num("doubleHitChance", 5);
  config.game.pauseBeforeFateMinMs = num("pauseMinMs", 1500);
  config.game.pauseBeforeFateMaxMs = num("pauseMaxMs", 3000);
  config.game.preHitDelayMinMs = num("hitDelayMinMs", 1000);
  config.game.preHitDelayMaxMs = num("hitDelayMaxMs", 3000);
  config.game.doubleHitDelayMinMs = num("doubleDelayMinMs", 700);
  config.game.doubleHitDelayMaxMs = num("doubleDelayMaxMs", 2500);
  config.safety.defaultDurationMs = num("duration", 700);

  config.game.noRepeatFate = document.getElementById("noRepeatMode").value === "on";
  config.game.escalationEnabled = document.getElementById("escalationEnabled").value === "on";
  config.game.escalationPerRound = num("escalationPerRound", 2);
  config.eventCards.enabled = document.getElementById("eventCardsEnabled").value === "on";
  config.eventCards.chancePercent = Math.max(0, Math.min(100, num("eventCardChance", 18)));
  config.eventCards.displayDurationMs = Math.max(0, numberWithDefault(document.getElementById("eventCardDisplayMs")?.value, config.eventCards.displayDurationMs ?? 4000));
  config.playerPages = config.playerPages || {};
  const playerPagesOn = document.getElementById("playerPagesEnabled").value === "on";
  config.playerPages.enabled = playerPagesOn;
  delete config.playerPages.qrCodesEnabled;
  config.playerPages.autoRefreshMs = Math.max(500, num("playerAutoRefreshMs", 2000));
  config.playerPages.useShockerIdAsAccessKey = Boolean(config.playerPages.useShockerIdAsAccessKey ?? false);
  config.hostPage = config.hostPage || {};
  const hostPageOn = document.getElementById("hostPageEnabled").value === "on";
  config.hostPage.enabled = hostPageOn;
  delete config.hostPage.qrCodesEnabled;
  delete config.hostPage.accessKey;
  config.hostPage.allowManualControl = true;
  config.audiencePage = config.audiencePage || {};
  const audiencePageOn = document.getElementById("audiencePageEnabled").value === "on";
  config.audiencePage.enabled = audiencePageOn;
  delete config.audiencePage.qrCodesEnabled;
  delete config.audiencePage.accessKey;
  config.economy = config.economy || {};
  config.economy.objectiveRewardPoints = Math.max(0, num("objectiveRewardPoints", 3));
  config.economy.bodyguardRewardPoints = Math.max(0, num("bodyguardRewardPoints", 2));
  config.economy.blessingCost = Math.max(0, num("blessingCost", 5));
  config.economy.curseCost = Math.max(0, num("curseCost", 5));
  config.economy.shieldCost = Math.max(0, num("shieldCost", 8));
  config.economy.mercyCost = Math.max(0, num("mercyCost", 6));
  config.economy.audienceTokenGrantAmount = Math.max(1, num("audienceTokenGrantAmount", 1));
  config.economy.audienceVoteThreshold = Math.max(1, num("audienceVoteThreshold", 3));
  config.economy.audienceCooldownSeconds = Math.max(0, num("audienceCooldownSeconds", 20));
  config.economy.audienceMaxVotesPerRound = Math.max(1, num("audienceMaxVotesPerRound", 1));
  config.economy.tokenCosts = config.economy.tokenCosts || {};
  config.economy.tokenCosts.shield = Math.max(0, num("shieldTokenCost", config.economy.shieldCost));
  config.economy.tokenCosts.mercy = Math.max(0, num("mercyTokenCost", config.economy.mercyCost));
  config.economy.tokenCosts.blessing = Math.max(0, num("blessingTokenCost", config.economy.blessingCost));
  config.economy.tokenCosts.curse = Math.max(0, num("curseTokenCost", config.economy.curseCost));
  config.economy.tokenCosts.chaos = Math.max(0, num("chaosTokenCost", 10));
  config.economy.tokenCosts.guarantee = Math.max(0, num("guaranteeTokenCost", 12));
  config.economy.tokenCosts.immunity = Math.max(0, num("immunityTokenCost", 10));
  config.economy.tokenCosts.doubleShock = Math.max(0, num("doubleShockTokenCost", 10));

  config.fateWheel = (config.fateWheel || []).map(f => {
    let min = Number(document.getElementById(`${f.key}_min`)?.value ?? f.min);
    let max = Number(document.getElementById(`${f.key}_max`)?.value ?? f.max);
    let weight = Number(document.getElementById(`${f.key}_weight`)?.value ?? f.weight);
    let enabled = document.getElementById(`${f.key}_enabled`)?.checked ?? (f.enabled ?? true);
    let escalates = document.getElementById(`${f.key}_escalates`)?.value ?? f.escalates ?? "neutral";
    const maxShock = Math.max(1, Math.min(100, Number(config?.safety?.serverMaxShockIntensity ?? 99)));
    min = Math.max(0, Math.min(maxShock, Math.round(Number.isFinite(min) ? min : f.min)));
    max = Math.max(0, Math.min(maxShock, Math.round(Number.isFinite(max) ? max : f.max)));
    if (max < min) [min, max] = [max, min];
    weight = Math.max(0, Math.round(Number.isFinite(weight) ? weight : f.weight));
    return { ...f, min, max, weight, enabled, escalates };
  });
  updateConfigPreview(false);
  return config;
}

function updateConfigPreview(collect=true) {
  if (!config) return;
  const preview = document.getElementById("configPreview");
  if (preview) {
    const clone = collect ? collectPreviewOnly() : JSON.parse(JSON.stringify(config));
    preview.value = JSON.stringify(clone, null, 2);
  }
  renderFateOdds();
  updateStats();
}

function collectPreviewOnly() {
  const clone = JSON.parse(JSON.stringify(config));
  try {
    clone.targetWheel.playerWeight = num("playerWeight", clone.targetWheel.playerWeight);
    clone.targetWheel.safeWeight = num("safeWeight", clone.targetWheel.safeWeight);
    clone.targetWheel.shockAllWeight = num("shockAllWeight", clone.targetWheel.shockAllWeight);
    clone.game.hiddenDoubleHitChancePercent = num("doubleHitChance", clone.game.hiddenDoubleHitChancePercent);
    clone.game.pauseBeforeFateMinMs = num("pauseMinMs", clone.game.pauseBeforeFateMinMs);
    clone.game.pauseBeforeFateMaxMs = num("pauseMaxMs", clone.game.pauseBeforeFateMaxMs);
    clone.game.preHitDelayMinMs = num("hitDelayMinMs", clone.game.preHitDelayMinMs);
    clone.game.preHitDelayMaxMs = num("hitDelayMaxMs", clone.game.preHitDelayMaxMs);
    clone.game.doubleHitDelayMinMs = num("doubleDelayMinMs", clone.game.doubleHitDelayMinMs);
    clone.game.doubleHitDelayMaxMs = num("doubleDelayMaxMs", clone.game.doubleHitDelayMaxMs);
    clone.game.noRepeatFate = document.getElementById("noRepeatMode").value === "on";
    clone.game.escalationEnabled = document.getElementById("escalationEnabled").value === "on";
    clone.game.escalationPerRound = num("escalationPerRound", clone.game.escalationPerRound);
    clone.eventCards = clone.eventCards || {};
    clone.eventCards.enabled = document.getElementById("eventCardsEnabled").value === "on";
    clone.eventCards.chancePercent = Math.max(0, Math.min(100, num("eventCardChance", clone.eventCards.chancePercent ?? 18)));
    clone.eventCards.displayDurationMs = Math.max(0, numberWithDefault(document.getElementById("eventCardDisplayMs")?.value, clone.eventCards.displayDurationMs ?? 4000));
    clone.playerPages = clone.playerPages || {};
    const playerPagesOn = document.getElementById("playerPagesEnabled").value === "on";
    clone.playerPages.enabled = playerPagesOn;
    delete clone.playerPages.qrCodesEnabled;
    clone.playerPages.autoRefreshMs = Math.max(500, num("playerAutoRefreshMs", clone.playerPages.autoRefreshMs ?? 2000));
    clone.playerPages.useShockerIdAsAccessKey = Boolean(clone.playerPages.useShockerIdAsAccessKey ?? false);
    clone.hostPage = clone.hostPage || {};
    const hostPageOn = document.getElementById("hostPageEnabled").value === "on";
    clone.hostPage.enabled = hostPageOn;
    delete clone.hostPage.qrCodesEnabled;
    delete clone.hostPage.accessKey;
    clone.hostPage.allowManualControl = true;
    clone.audiencePage = clone.audiencePage || {};
    const audiencePageOn = document.getElementById("audiencePageEnabled").value === "on";
    clone.audiencePage.enabled = audiencePageOn;
    delete clone.audiencePage.qrCodesEnabled;
    delete clone.audiencePage.accessKey;
    clone.economy = clone.economy || {};
    clone.economy.objectiveRewardPoints = Math.max(0, num("objectiveRewardPoints", clone.economy.objectiveRewardPoints ?? 3));
    clone.economy.bodyguardRewardPoints = Math.max(0, num("bodyguardRewardPoints", clone.economy.bodyguardRewardPoints ?? 2));
    clone.economy.blessingCost = Math.max(0, num("blessingCost", clone.economy.blessingCost ?? 5));
    clone.economy.curseCost = Math.max(0, num("curseCost", clone.economy.curseCost ?? 5));
    clone.economy.shieldCost = Math.max(0, num("shieldCost", clone.economy.shieldCost ?? 8));
    clone.economy.mercyCost = Math.max(0, num("mercyCost", clone.economy.mercyCost ?? 6));
    clone.economy.audienceTokenGrantAmount = Math.max(1, num("audienceTokenGrantAmount", clone.economy.audienceTokenGrantAmount ?? 1));
    clone.economy.audienceVoteThreshold = Math.max(1, num("audienceVoteThreshold", clone.economy.audienceVoteThreshold ?? 3));
    clone.economy.audienceCooldownSeconds = Math.max(0, num("audienceCooldownSeconds", clone.economy.audienceCooldownSeconds ?? 20));
    clone.economy.audienceMaxVotesPerRound = Math.max(1, num("audienceMaxVotesPerRound", clone.economy.audienceMaxVotesPerRound ?? 1));
    clone.economy.tokenCosts = clone.economy.tokenCosts || {};
    clone.economy.tokenCosts.shield = Math.max(0, num("shieldTokenCost", clone.economy.tokenCosts.shield ?? clone.economy.shieldCost ?? 8));
    clone.economy.tokenCosts.mercy = Math.max(0, num("mercyTokenCost", clone.economy.tokenCosts.mercy ?? clone.economy.mercyCost ?? 6));
    clone.economy.tokenCosts.blessing = Math.max(0, num("blessingTokenCost", clone.economy.tokenCosts.blessing ?? clone.economy.blessingCost ?? 5));
    clone.economy.tokenCosts.curse = Math.max(0, num("curseTokenCost", clone.economy.tokenCosts.curse ?? clone.economy.curseCost ?? 5));
    clone.economy.tokenCosts.chaos = Math.max(0, num("chaosTokenCost", clone.economy.tokenCosts.chaos ?? 10));
    clone.economy.tokenCosts.guarantee = Math.max(0, num("guaranteeTokenCost", clone.economy.tokenCosts.guarantee ?? clone.economy.guaranteeTokenCost ?? clone.economy.guaranteedPickCost ?? 12));
    clone.economy.tokenCosts.immunity = Math.max(0, num("immunityTokenCost", clone.economy.tokenCosts.immunity ?? clone.economy.immunityTokenCost ?? 10));
    clone.economy.tokenCosts.doubleShock = Math.max(0, num("doubleShockTokenCost", clone.economy.tokenCosts.doubleShock ?? clone.economy.doubleShockTokenCost ?? 10));
    clone.safety.defaultDurationMs = num("duration", clone.safety.defaultDurationMs);
    clone.fateWheel = getFateConfig(false);
  } catch {}
  return clone;
}

function renderFateSettings() {
  const host = document.getElementById("fateSettings");
  host.innerHTML = "";

  (config.fateWheel || []).forEach(f => {
    const row = document.createElement("div");
    row.className = "fateGrid";
    row.innerHTML = `
      <label class="toggle" title="Enable/disable this fate during the game">
        <input id="${f.key}_enabled" type="checkbox" ${(f.enabled ?? true) ? "checked" : ""}>
        <span class="toggleText">${(f.enabled ?? true) ? "ON" : "OFF"}</span>
      </label>
      <label class="fateName" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</label>
      <div class="rangePair">
        <input id="${f.key}_min" class="numSmall" type="number" min="0" max="100" value="${f.min}" title="Minimum">
        <input id="${f.key}_max" class="numSmall" type="number" min="0" max="100" value="${f.max}" title="Maximum">
      </div>
      <input id="${f.key}_weight" class="numWeight" type="number" min="0" max="1000" value="${f.weight}" title="Base weight">
      <select id="${f.key}_escalates">
        <option value="down"${f.escalates === "down" ? " selected" : ""}>Down</option>
        <option value="neutral"${f.escalates === "neutral" ? " selected" : ""}>Neutral</option>
        <option value="up"${f.escalates === "up" ? " selected" : ""}>Up</option>
      </select>
    `;
    host.appendChild(row);
  });

  (config.fateWheel || []).forEach(f => {
    [`${f.key}_enabled`, `${f.key}_min`, `${f.key}_max`, `${f.key}_weight`, `${f.key}_escalates`].forEach(id => {
      document.getElementById(id)?.addEventListener("change", (event) => {
        if (id.endsWith("_enabled")) {
          const text = event.target.closest(".toggle")?.querySelector(".toggleText");
          if (text) text.textContent = event.target.checked ? "ON" : "OFF";
        }
        fateDeck = [];
        redrawAllWheels();
        updateConfigPreview();
      });
    });
  });
}

function showEventOverlay(card, phaseText="Event card triggered") {
  if (!eventOverlay) return;
  eventTitle.textContent = card?.title || "Event Card";
  eventDescription.textContent = card?.description || card?.text || "A round modifier has appeared.";
  eventPickerLine.textContent = phaseText;
  eventOptions.innerHTML = "";
  eventResult.textContent = "";
  eventContinueBtn.hidden = true;
  eventOverlay.hidden = false;
  eventOverlay.classList.add("show");
  eventCardBox.classList.toggle("affectsTarget", cardAffects(card, "target") && !cardAffects(card, "fate"));
  eventCardBox.classList.toggle("affectsFate", cardAffects(card, "fate") && !cardAffects(card, "target"));
  eventCardBox.classList.toggle("affectsBoth", cardAffects(card, "target") && cardAffects(card, "fate"));
  targetWheel.closest(".wheelCard")?.classList.toggle("eventAffected", cardAffects(card, "target"));
  fateWheel.closest(".wheelCard")?.classList.toggle("eventAffected", cardAffects(card, "fate"));
}

function hideEventOverlay() {
  if (!eventOverlay) return;
  eventOverlay.classList.remove("show");
  eventOverlay.hidden = true;
  eventOptions.innerHTML = "";
  targetWheel.closest(".wheelCard")?.classList.remove("eventAffected");
  fateWheel.closest(".wheelCard")?.classList.remove("eventAffected");
}

function clearActiveEventCardPanel(stateText = "Waiting for the next event roll...") {
  activeRoundEvent = null;
  updateEventCardPanel(null, stateText);
  hideEventOverlay();
}

function waitForEventContinue(ms) {
  return new Promise(resolve => {
    const delayMs = Math.max(0, Number(ms || 0));

    // A value of 0 used to show the continue button but never start a timer,
    // which could leave the round stuck on "Checking for event card...".
    // Treat 0/blank/invalid as "do not pause for the overlay".
    if (!delayMs || !eventContinueBtn) {
      if (eventContinueBtn) {
        eventContinueBtn.hidden = true;
        eventContinueBtn.onclick = null;
      }
      resolve();
      return;
    }

    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      eventContinueBtn.onclick = null;
      eventContinueBtn.hidden = true;
      resolve();
    };
    eventContinueBtn.hidden = false;
    eventContinueBtn.onclick = finish;
    timer = setTimeout(finish, delayMs);
  });
}

function showEventResult(text) {
  eventResult.textContent = text || "";
  if (text) log(`Event result: ${text}`);
}

function choiceButtons(options, onPick) {
  eventOptions.innerHTML = "";
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "eventOptionButton";
    btn.textContent = opt.label;
    btn.onclick = () => onPick(opt);
    eventOptions.appendChild(btn);
  });
}
