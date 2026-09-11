
async function postEventLog(payload) {
  try {
    await fetch("/api/event-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
  } catch (err) {
    log(`Could not write event log: ${err.message}`);
  }
}

async function postRoundResult(payload) {
  try {
    await fetch("/api/round-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
  } catch (err) {
    log(`Could not write round result: ${err.message}`);
  }
}

async function getServerSessionState() {
  const res = await fetch("/api/session", { cache: "no-store" });
  const state = await res.json();
  if (!res.ok) throw new Error(state.error || "Could not load server session");
  return state;
}

async function loadSessionState() {
  try {
    const res = await fetch("/api/session");
    const state = await res.json();
    if (!res.ok) throw new Error(state.error || "Could not load session state");
    applySessionSnapshot(state);
    sessionSaveEnabled = true;
    log(`Session restored from server state. Round ${roundNumber}.`);
  } catch (err) {
    sessionSaveEnabled = true;
    ensureAllPlayerStats();
    log(`Session restore skipped: ${err.message}`);
  }
}

function saveSessionState(reason = "state change") {
  if (!sessionSaveEnabled) return;
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(async () => {
    sessionSaveTimer = null;
    try {
      const snapshot = buildSessionSnapshot();
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save session state");
      log(`Session saved (${reason}).`);
      if (document.getElementById("objectiveDetails")?.open) loadPlayerObjectivePanel();
    } catch (err) {
      log(`Session save failed: ${err.message}`);
    }
  }, 150);
}

async function consumeRoundModifiers(modifiers) {
  const ids = (modifiers || []).map(m => typeof m === "string" ? m : m?.id).filter(Boolean);
  if (!ids.length) return;
  try {
    await fetch("/api/round-modifiers/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
  } catch (err) {
    log(`Could not consume pending modifiers: ${err.message}`);
  }
}

async function resetServerSessionState() {
  try {
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer);
      sessionSaveTimer = null;
    }

    const res = await fetch("/api/session/reset", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not reset session state");

    if (data.archivedTo) log(`Server session state archived to ${data.archivedTo}.`);
    else log("Server session state reset. No previous state file existed to archive.");

    return data.session || null;
  } catch (err) {
    log(`Server session reset failed: ${err.message}`);
    window.alert(`Could not reset server session state: ${err.message}`);
    return null;
  }
}

async function loadConfig() {
  const res = await fetch("/api/config");
  config = await res.json();
  applyConfigToForm();
  renderFateSettings();
  updateConfigPreview();
  redrawAllWheels();
  const displayTitle = config.app?.displayTitle || config.ui?.pageTitle || config.app?.name || "OpenShock Roulette";
  document.getElementById("pageTitle").textContent = displayTitle;
  document.title = displayTitle;
  const subtitleEl = document.getElementById("subtitleText");
  if (subtitleEl) subtitleEl.textContent = config.app?.subtitle || subtitleEl.textContent;
  log("Loaded config.json.");
}

async function loadEventCards() {
  try {
    const res = await fetch("/api/event-cards");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load event-cards.json");
    eventCardsConfig = data;
    log(`Loaded event-cards.json with ${(data.cards || []).length} card(s).`);
  } catch (err) {
    eventCardsConfig = { enabled: false, cards: [] };
    log(`Event cards disabled: ${err.message}`);
  }
}

async function saveConfig() {
  collectFormToConfig();
  const res = await fetch("/api/config", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(config)
  });
  const data = await res.json();
  if (!res.ok) {
    log("Config save failed: " + (data.error || JSON.stringify(data)));
    return;
  }
  config = data.config;
  log("Saved config.json.");
  loadPlayerObjectivePanel();
}

async function loadShockers({ preserveSession = true, forceRefresh = false } = {}) {
  targetResult.textContent = forceRefresh ? "Refreshing collars from OpenShock..." : "Loading collars...";
  const res = await fetch(`/api/shockers${forceRefresh ? "?refresh=1" : ""}`);
  const data = await res.json();
  shockers = data.shockers || [];
  configuredPlayers = Array.isArray(data.players) ? data.players : [];
  ensureAllPlayerStats();

  if (!preserveSession) {
    eliminated.clear();
    if (config?.game?.autoResetEscalationOnReload !== false) resetGame(false, { save: false });
  } else {
    const validIds = typeof getValidLogicalPlayerIds === "function" ? getValidLogicalPlayerIds() : new Set(shockers.map(s => String(s.id)));
    eliminated = new Set(Array.from(eliminated).filter(id => validIds.has(String(id))));
    lastSelectedTargets = lastSelectedTargets.filter(s => validIds.has(String(s.id)));
    lastShockedTargets = lastShockedTargets.filter(s => validIds.has(String(s.id)));
  }

  const cacheNote = data.cached ? "cached" : "live";
  document.getElementById("sourcePill").textContent = `${configuredPlayers.length} players · ${data.shockers.length} Shock · ${cacheNote}`;
  renderPlayers();
  redrawAllWheels();
  targetResult.textContent = configuredPlayers.length ? `${configuredPlayers.length} players loaded` : "No players configured";
  fateResult.textContent = "Waiting...";
  if (roundNumber === 0) setMainResult("Ready");
  if (data.warning) log(data.warning);
  saveSessionState("shocker reload");
}

async function beginOutputRun() {
  const res = await fetch("/api/output-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not start output run");
  return data.outputRunToken;
}

async function sendControl(shocker, selectedValue, outputRunToken = null) {
  const duration = Number(document.getElementById("duration").value || config?.safety?.defaultDurationMs || 700);
  const res = await fetch("/api/control", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ id: shocker.id, selectedValue, duration, exclusive: true, outputRunToken })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || JSON.stringify(data));
  return data.sent;
}

async function stopAll() {
  outputCancellationVersion += 1;
  try {
    const ids = shockers.map(s => s.id);
    const res = await fetch("/api/stop-all", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ ids })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "One or more output providers could not be stopped");
    log("STOP ALL sent.");
  } catch (err) {
    log("STOP failed: " + err.message);
  }
}

async function savePlayerMultipliers() {
  try {
    await fetch("/api/player-multipliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerMultipliers })
    });
    saveSessionState("player multiplier update");
  } catch (err) {
    log(`Could not save player multipliers: ${err.message}`);
  }
}


let latestOutputStatus = null;
let outputStatusTimer = null;

function outputBadgeClass(provider) {
  if (!provider?.configured) return "status-disabled";
  if (provider.disabled) return "status-disabled";
  return provider.online || provider.reachable || provider.connected ? "status-ok" : "status-bad";
}

function renderMainOutputStatus() {
  if (!latestOutputStatus) return;
  const shock = latestOutputStatus.providers?.shock || {};
  const toy = latestOutputStatus.providers?.toy || {};
  const shockEl = document.getElementById("mainShockStatus");
  const toyEl = document.getElementById("mainToyStatus");
  if (shockEl) { shockEl.className = `outputBadge ${!shock.configured ? "status-disabled" : shock.reachable ? "status-ok" : "status-bad"}`; shockEl.textContent = `● Shock${shock.configured ? "" : " (not configured)"}`; }
  if (toyEl) { toyEl.className = `outputBadge ${!toy.configured || !toy.enabled ? "status-disabled" : toy.connected ? "status-ok" : "status-bad"}`; toyEl.textContent = `● Toy${toy.configured ? toy.enabled ? "" : " (disabled)" : " (not configured)"}`; }
  document.querySelectorAll("[data-player-output-status]").forEach(el => {
    const item = latestOutputStatus.players?.find(player => String(player.playerId) === String(el.dataset.playerOutputStatus));
    if (!item) return;
    const parts = [];
    if (item.shock?.configured) parts.push(`<span class="${item.shock.disabled ? "status-disabled" : item.shock.online ? "status-ok" : "status-bad"}">● Shock</span>`);
    if (item.toy?.configured) parts.push(`<span class="${item.toy.disabled ? "status-disabled" : item.toy.online ? "status-ok" : "status-bad"}">● Toy</span>`);
    el.innerHTML = parts.join(" ") || `<span class="status-bad">● No output</span>`;
  });
}

async function loadOutputStatus() {
  try {
    const res = await fetch("/api/output-status", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load output status");
    latestOutputStatus = data;
    for (const player of configuredPlayers || []) {
      const current = data.players?.find(item => item.playerId === player.id);
      for (const device of player.devices || []) {
        const live = current?.devices?.find(item => item.id === device.id && item.provider === device.provider);
        device.online = live?.canActivate === true;
        if (live) device.mappingReady = live.mappingReady;
      }
    }
    renderMainOutputStatus();
  } catch (err) {
    const note = document.getElementById("outputStatusNote");
    if (note) note.textContent = err.message;
  }
}

function startOutputStatusPolling() {
  clearInterval(outputStatusTimer);
  loadOutputStatus();
  outputStatusTimer = setInterval(loadOutputStatus, 2500);
}
