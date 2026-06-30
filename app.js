let config = null;
let shockers = [];
let eliminated = new Set();
let targetRotation = 0;
let fateRotation = 0;
let roundNumber = 0;
let fateDeck = [];
let eventCardsConfig = { enabled: false, cards: [] };
let activeRoundEvent = null;
let lastShockedTargets = [];
let lastSelectedTargets = [];
let lastTargetPicked = null;
let playerStats = {};
let playerMultipliers = {};
let sessionSaveEnabled = false;
let hostSpinPaused = false;
let hostCommandPollTimer = null;
let sessionSaveTimer = null;

const targetWheel = document.getElementById("targetWheel");
const fateWheel = document.getElementById("fateWheel");
const targetResult = document.getElementById("targetResult");
const fateResult = document.getElementById("fateResult");
const mainResult = document.getElementById("mainResult");
const playersDiv = document.getElementById("players");
const spinBtn = document.getElementById("spinBtn");
const eventOverlay = document.getElementById("eventOverlay");
const eventCardBox = document.getElementById("eventCardBox");
const eventTitle = document.getElementById("eventTitle");
const eventDescription = document.getElementById("eventDescription");
const eventPickerLine = document.getElementById("eventPickerLine");
const eventOptions = document.getElementById("eventOptions");
const eventResult = document.getElementById("eventResult");
const eventContinueBtn = document.getElementById("eventContinueBtn");


async function activateTargets(targets, value, roundState = null) {
  const appliedById = {};
  for (const s of targets) {
    const appliedValue = applyPlayerMultiplier(value, s.id);
    appliedById[s.id] = appliedValue;
    await sendControl(s, appliedValue);
  }

  const doubleChance = roundState?.doubleHitChanceOverride !== null && roundState?.doubleHitChanceOverride !== undefined
    ? Math.max(0, Math.min(100, Number(roundState.doubleHitChanceOverride)))
    : getPercent("doubleHitChance");
  if (value > 0 && rollPercent(doubleChance)) {
    const secondDelay = randInt(document.getElementById("doubleDelayMinMs").value, document.getElementById("doubleDelayMaxMs").value);
    log(`Hidden double-hit triggered. Second hit in ${secondDelay} ms.`);
    await sleep(secondDelay);
    for (const s of targets) await sendControl(s, appliedById[s.id] ?? applyPlayerMultiplier(value, s.id));
  }
  const forcedDoubleIds = roundState?.forcedDoubleShockTargetIds || new Set();
  const forcedTargets = (targets || []).filter(s => forcedDoubleIds.has(String(s.id)));
  if (value > 0 && forcedTargets.length) {
    const secondDelay = randInt(document.getElementById("doubleDelayMinMs").value, document.getElementById("doubleDelayMaxMs").value);
    log(`Forced double-shock token triggered for ${forcedTargets.map(s => s.name).join(", ")}. Second hit in ${secondDelay} ms.`);
    await sleep(secondDelay);
    for (const s of forcedTargets) await sendControl(s, appliedById[s.id] ?? applyPlayerMultiplier(value, s.id));
    for (const s of forcedTargets) {
      const mod = (roundState.pendingRoundModifiers || []).find(m => m.type === "forcedDoubleShockNextRound" && String(m.targetPlayerId) === String(s.id));
      if (mod) markRoundModifierConsumed(roundState, mod, "forced double shock applied");
    }
  }
  return appliedById;
}

async function spinRound() {
  if (hostSpinPaused) {
    log("Spin blocked: host pause is active.");
    setMainResult("Paused by host");
    return;
  }
  collectFormToConfig();

  spinBtn.disabled = true;
  fateDeck = document.getElementById("noRepeatMode").value === "on" ? fateDeck : [];
  setMainResult("Checking for event card...");
  fateResult.textContent = "Waiting...";
  roundNumber++;

  try {
    let serverPendingRoundModifiers = [];
    try {
      const serverState = await getServerSessionState();
      serverPendingRoundModifiers = Array.isArray(serverState.pendingRoundModifiers) ? serverState.pendingRoundModifiers : [];
    } catch (err) {
      log(`Pending modifier load skipped: ${err.message}`);
    }
    let roundState = await runPreRoundEvent(serverPendingRoundModifiers);
    roundState.pendingRoundModifiers = serverPendingRoundModifiers;
    applyPendingModifiersBeforeTarget(roundState);
    const targetSegments = buildTargetSegmentsForRound(roundState);
    if (!targetSegments.length && !roundState.forcedTarget) {
      roundNumber = Math.max(0, roundNumber - 1);
      targetResult.textContent = "No eligible targets";
      fateResult.textContent = "Round aborted.";
      setMainResult("No eligible targets - round aborted.", "safe");
      log("Round aborted: no eligible targets after filters/modifiers.");
      redrawAllWheels();
      saveSessionState("round aborted - no eligible targets");
      clearActiveEventCardPanel("Round aborted.");
      return;
    }

    redrawAllWheels();
    drawCanvasWheel(targetWheel, targetSegments, "target");

    let targetPicked = roundState.forcedTarget || weightedPick(targetSegments);

    if (roundState.forcedTarget) {
      targetResult.textContent = targetPicked.type === "all"
        ? "ALL manually selected"
        : `${(targetPicked.shockers || [targetPicked.shocker]).filter(Boolean).map(s => s.name).join(" + ")} manually selected`;
      setMainResult(targetResult.textContent, targetPicked.type === "all" ? "all" : "hit");
    } else {
      spinWheelToSegment(targetWheel, targetSegments, targetPicked, "target");
      targetResult.textContent = "Spinning target...";
      setMainResult("Target spinning...");
      await sleep(config?.ui?.wheelSpinMs ?? 4200);
    }

    if (targetPicked.type === "virtual") {
      const virtualName = targetPicked.virtualName || targetPicked.name || targetPicked.label || "Virtual target";
      const resultText = targetPicked.resultText || `${virtualName} was selected. No real player is affected.`;
      targetResult.textContent = virtualName;
      fateResult.textContent = "No fate spin.";
      setMainResult(resultText, "safe");
      log(`Round ${roundNumber}: ${resultText}`);
      lastSelectedTargets = [];
      lastTargetPicked = targetPicked;
      renderPlayers();
      updateStats();
      await consumeRoundModifiers(consumedRoundModifierIds(roundState));
      await postRoundResult({
        roundNumber,
        eventId: roundState.card?.id || null,
        eventTitle: roundState.card?.title || null,
        resultType: "virtual",
        targets: [],
        virtualTarget: {
          id: targetPicked.virtualId || null,
          name: virtualName,
          resultText
        }
      });
      saveSessionState("virtual target round");
      return;
    }

    if (targetPicked.type === "safe") {
      targetResult.textContent = "SAFE";
      fateResult.textContent = "No fate spin.";
      setMainResult("SAFE - Nobody gets hit.", "safe");
      log(`Round ${roundNumber}: SAFE${roundState.card ? ` after event ${roundState.card.title || roundState.card.id}` : ""}`);
      recordSafeRoundForActivePlayers();
      lastSelectedTargets = [];
      lastTargetPicked = targetPicked;
      renderPlayers();
      updateStats();
      await consumeRoundModifiers(consumedRoundModifierIds(roundState));
      await postRoundResult({ roundNumber, eventId: roundState.card?.id || null, eventTitle: roundState.card?.title || null, resultType: "safe", targets: [] });
      saveSessionState("safe round");
      return;
    }

    let targets = targetPicked.type === "all"
      ? activeShockers()
      : (targetPicked.type === "multi" ? (targetPicked.shockers || []).filter(Boolean) : [targetPicked.shocker].filter(Boolean));
    if (roundState.extraRandomTargets && targetPicked.type === "player") {
      let candidates = activeShockers().filter(s => !targets.some(t => t.id === s.id));
      for (let i = 0; i < Number(roundState.extraRandomTargets || 0) && candidates.length; i++) {
        const pickedExtra = candidates[Math.floor(Math.random() * candidates.length)];
        targets.push(pickedExtra);
        candidates = candidates.filter(s => s.id !== pickedExtra.id);
      }
    }

    if (roundState.extraTargets?.length) {
      for (const extra of roundState.extraTargets) {
        if (extra?.id && !targets.some(t => t.id === extra.id)) targets.push(extra);
      }
    }

    ({ targetPicked, targets } = applyPendingModifiersAfterTarget(roundState, targetPicked, targets));
    ({ targetPicked, targets } = await resolvePostTargetEffects(roundState, targetPicked, targets));

    const immuneIds = roundState.immuneTargetIds || new Set();
    const beforeImmunity = targets.length;
    targets = targets.filter(t => !immuneIds.has(String(t.id)));
    if (beforeImmunity !== targets.length) {
      for (const id of immuneIds) markRoundModifierConsumed(roundState, { id: (roundState.pendingRoundModifiers || []).find(m => m.type === "immunityNextRound" && String(m.targetPlayerId) === String(id))?.id }, "immunity applied");
      log("Immunity token prevented one or more hits this round.");
    }
    if (!targets.length) {
      targetResult.textContent = "IMMUNITY";
      fateResult.textContent = "No fate spin.";
      setMainResult("IMMUNITY - Hit ignored.", "safe");
      lastSelectedTargets = [];
      lastTargetPicked = { type: "safe", label: "IMMUNITY" };
      await consumeRoundModifiers(consumedRoundModifierIds(roundState));
      await postRoundResult({ roundNumber, eventId: roundState.card?.id || null, eventTitle: roundState.card?.title || null, resultType: "immunity", targets: [] });
      saveSessionState("immunity round");
      return;
    }

    targetResult.textContent = formatTargetResultText(targetPicked, targets);
    setMainResult(targetResult.textContent, targetPicked.type === "all" ? "all" : "hit");

    const pause = randInt(document.getElementById("pauseMinMs").value, document.getElementById("pauseMaxMs").value);
    fateResult.textContent = "Preparing fate...";
    log(`Round ${roundNumber}: ${targetResult.textContent}. Fate starts in ${pause} ms.`);
    await sleep(pause);

    const fateSegments = getFateConfigForRound(roundState).filter(f => f.weight > 0);
    drawCanvasWheel(fateWheel, fateSegments, "fate");
    const fatePicked = pickFateForRound(roundState);
    spinWheelToSegment(fateWheel, fateSegments, fatePicked, "fate");

    fateResult.textContent = "Spinning fate...";
    setMainResult("Calculating fate...");
    await sleep(config?.ui?.wheelSpinMs ?? 4200);

    let value = roundState.forceValue !== null && roundState.forceValue !== undefined
      ? roundState.forceValue
      : pickStrengthFromFate(fatePicked);
    if (value > 0) {
      value = Math.round((value * Number(roundState.valueMultiplier || 1)) + Number(roundState.valueOffset || 0));
      const maxShock = Math.max(1, Math.min(100, Number(config?.safety?.serverMaxShockIntensity ?? 99)));
      value = Math.max(1, Math.min(maxShock, value));
    }
    const previewAppliedById = Object.fromEntries((targets || []).filter(Boolean).map(s => [s.id, applyPlayerMultiplier(value, s.id)]));
    const appliedText = describeAppliedValues(targets, value, previewAppliedById);
    fateResult.textContent = `${fatePicked.name}: ${appliedText}`;
    const mainText = `${formatTargetResultText(targetPicked, targets)} - ${appliedText}`;
    setMainResult(mainText, value === 0 ? "" : (targetPicked.type === "all" ? "all" : "hit"));

    const hitDelay = randInt(document.getElementById("hitDelayMinMs").value, document.getElementById("hitDelayMaxMs").value);
    log(`Round ${roundNumber}: ${mainText}. Activation in ${hitDelay} ms.`);
    await sleep(hitDelay);

    const appliedById = await activateTargets(targets, value, roundState);
    recordRoundTargets(targets, { value, valueByTargetId: appliedById, wasAll: targetPicked.type === "all" });
    if (value > 0) {
      lastShockedTargets = [...targets];
    }
    lastSelectedTargets = [...targets];
    lastTargetPicked = targetPicked;
    log(`Round ${roundNumber}: Activated ${targets.length} target(s). ${describeAppliedValues(targets, value, appliedById)}.`);
    await postRoundResult({
      roundNumber,
      eventId: roundState.card?.id || null,
      eventTitle: roundState.card?.title || null,
      resultType: value > 0 ? "shock" : "vibe",
      targets: (targets || []).map(s => ({ playerId: s.id, deviceId: s.id, name: s.name, rolledValue: value, multiplierPercent: getPlayerMultiplier(s.id), appliedValue: appliedById[s.id] ?? applyPlayerMultiplier(value, s.id) }))
    });
    renderPlayers();
    updateStats();
    await consumeRoundModifiers(consumedRoundModifierIds(roundState));
    saveSessionState("round completed");
  } catch (err) {
    setMainResult("Error");
    log(err.message);
    hideEventOverlay();
  } finally {
    spinBtn.disabled = false;
  }
}

function eliminateOne() {
  const active = activeShockers();
  if (!active.length) {
    log("No active players to eliminate.");
    return;
  }
  const picked = active[Math.floor(Math.random() * active.length)];
  eliminated.add(picked.id);
  renderPlayers();
  redrawAllWheels();
  log(`Eliminated 1: ${picked.name}`);
  saveSessionState("random elimination");
}

async function resetGame(writeLog=true, { save = true, resetServer = false } = {}) {
  let freshServerState = null;

  if (resetServer) {
    const ok = window.confirm("Reset the current game state? The current SQLite session will be archived as JSON with a timestamp.");
    if (!ok) return;

    sessionSaveEnabled = false;
    freshServerState = await resetServerSessionState();
    sessionSaveEnabled = true;

    if (!freshServerState) return;
  }

  roundNumber = 0;
  fateDeck = [];
  activeRoundEvent = null;
  lastShockedTargets = [];
  lastSelectedTargets = [];
  lastTargetPicked = null;
  eliminated.clear();
  playerStats = {};
  ensureAllPlayerStats();

  if (freshServerState) {
    applySessionSnapshot(freshServerState);
  } else {
    targetResult.textContent = shockers.length ? `${shockers.length} collars loaded` : "No collars found";
    fateResult.textContent = "Waiting...";
    setMainResult("Ready");
    renderPlayers();
    redrawAllWheels();
  }

  if (writeLog) log("Game reset. Escalation round counter back to 0.");
  loadPlayerObjectivePanel();
  if (!resetServer && save) saveSessionState("game reset");
}

[
  "playerWeight","safeWeight","shockAllWeight","doubleHitChance",
  "pauseMinMs","pauseMaxMs","hitDelayMinMs","hitDelayMaxMs",
  "doubleDelayMinMs","doubleDelayMaxMs","duration","noRepeatMode",
  "escalationEnabled","escalationPerRound",
  "eventCardsEnabled","eventCardChance","eventCardDisplayMs",
  "playerPagesEnabled","playerAutoRefreshMs",
  "hostPageEnabled",
  "audiencePageEnabled",
  "objectiveRewardPoints","bodyguardRewardPoints","blessingCost","curseCost","shieldCost","mercyCost",
  "audienceTokenGrantAmount","audienceVoteThreshold","audienceCooldownSeconds","audienceMaxVotesPerRound",
  "shieldTokenCost","mercyTokenCost","blessingTokenCost","curseTokenCost","chaosTokenCost","guaranteeTokenCost"
].forEach(id => {
  document.getElementById(id).addEventListener("change", async () => {
    syncPageQrControls(id);
    redrawAllWheels();
    updateConfigPreview();
    if (["playerPagesEnabled", "hostPageEnabled", "audiencePageEnabled"].includes(id)) {
      await saveConfig();
      log(`${id} saved and applied live.`);
    }
  });
});

document.getElementById("saveConfigBtn").onclick = saveConfig;
document.getElementById("reloadConfigBtn").onclick = async () => { await loadConfig(); renderPlayers(); saveSessionState("config reload"); };
document.getElementById("resetGameBtn").onclick = () => resetGame(true, { resetServer: true });
document.getElementById("spinBtn").onclick = spinRound;
document.getElementById("stopBtn").onclick = stopAll;
document.getElementById("reloadBtn").onclick = () => loadShockers({ preserveSession: true, forceRefresh: true });
document.getElementById("elimOneBtn").onclick = eliminateOne;

document.addEventListener("keydown", (event) => {
  if (event.repeat) return;

  const activeElement = document.activeElement;
  const isTyping =
    activeElement &&
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(activeElement.tagName);

  if (isTyping) return;

  const keyboard = config?.keyboard || {};
  if (keyboard.spinEnabled === false) return;

  const spinKey = keyboard.spinKey || "F13";

  if (event.code === spinKey) {
    event.preventDefault();

    if (!spinBtn.disabled) {
      spinRound();
    }
  }
});

(async function init() {
  updateEventCardPanel(null);
  await loadEventCards();
  await loadConfig();
  await loadShockers({ preserveSession: true });
  await loadSessionState();
  await loadPlayerObjectivePanel();
  startHostCommandPolling();
})();
