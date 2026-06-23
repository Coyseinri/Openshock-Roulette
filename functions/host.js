// OSR host command helpers

const baseWaitForEventContinue = waitForEventContinue;
let mainGameStatePanelRefreshInFlight = false;

function eventCardRequiresManualContinue(card) {
  if (!card) return false;
  if (card.requireManualContinue === true || card.manualContinueRequired === true || card.waitForContinue === true) return true;
  return String(card.id || "").toLowerCase() === "hr-complaint";
}

waitForEventContinue = function waitForEventContinueWithManualCards(ms, options = {}) {
  const card = options?.card || activeRoundEvent || null;
  if (!eventCardRequiresManualContinue(card)) return baseWaitForEventContinue(ms);

  return new Promise(resolve => {
    if (!eventContinueBtn) {
      resolve();
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      eventContinueBtn.onclick = null;
      eventContinueBtn.hidden = true;
      resolve();
    };

    eventPickerLine.textContent = "Waiting for Continue...";
    eventContinueBtn.hidden = false;
    eventContinueBtn.onclick = finish;
  });
};

function refreshMainGameStatePanel() {
  if (mainGameStatePanelRefreshInFlight || typeof loadPlayerObjectivePanel !== "function") return;
  mainGameStatePanelRefreshInFlight = true;
  Promise.resolve(loadPlayerObjectivePanel())
    .catch(() => {})
    .finally(() => { mainGameStatePanelRefreshInFlight = false; });
}

function markRoundModifierConsumed(roundState, mod, reason = "used") {
  if (!roundState || !mod?.id) return;
  if (!roundState.consumedModifierIds) roundState.consumedModifierIds = new Set();
  roundState.consumedModifierIds.add(String(mod.id));
  mod.consumedReason = reason;
}

function consumedRoundModifierIds(roundState) {
  return Array.from(roundState?.consumedModifierIds || []);
}

function applyPendingModifiersBeforeTarget(roundState) {
  const mods = roundState.pendingRoundModifiers || [];
  roundState.bodyguardRedirects = new Map();
  for (const mod of mods) {
    if (mod.type === "bodyguardNextRound" && mod.targetPlayerId && mod.bodyguardPlayerId) {
      const protectedId = String(mod.targetPlayerId);
      const bodyguardId = String(mod.bodyguardPlayerId);
      const protectedPlayer = getShockerById(protectedId);
      const bodyguard = getShockerById(bodyguardId);
      if (protectedPlayer && bodyguard && protectedId !== bodyguardId) {
        roundState.bodyguardRedirects.set(protectedId, { protectedId, bodyguardId, protectedPlayer, bodyguard, modifierId: mod.id });
        log(`Pending modifier: ${bodyguard.name} is bodyguarding ${protectedPlayer.name}.`);
      }
    }
    if (mod.type === "shieldNextRound" && mod.targetPlayerId) {
      roundState.excludeTargetIds.add(String(mod.targetPlayerId));
      markRoundModifierConsumed(roundState, mod, "shield applied");
      log(`Pending modifier: ${getShockerName(mod.targetPlayerId, mod.targetPlayerId)} is shielded this round.`);
    }
    if (mod.type === "immunityNextRound" && mod.targetPlayerId) {
      roundState.immuneTargetIds = roundState.immuneTargetIds || new Set();
      roundState.immuneTargetIds.add(String(mod.targetPlayerId));
      log(`Pending modifier: ${getShockerName(mod.targetPlayerId, mod.targetPlayerId)} has immunity this round.`);
    }
    if (mod.type === "forcedDoubleShockNextRound" && mod.targetPlayerId) {
      roundState.forcedDoubleShockTargetIds = roundState.forcedDoubleShockTargetIds || new Set();
      roundState.forcedDoubleShockTargetIds.add(String(mod.targetPlayerId));
      log(`Pending modifier: forced double shock armed for ${getShockerName(mod.targetPlayerId, mod.targetPlayerId)}.`);
    }
    if (mod.type === "volunteerNextRound" && mod.playerId) {
      const volunteer = getShockerById(mod.playerId);
      if (volunteer) {
        roundState.extraTargets.push(volunteer);
        markRoundModifierConsumed(roundState, mod, "volunteer applied");
      }
    }

    if (mod.type === "guaranteedPickNextRound" && mod.targetPlayerId) {
      const guaranteed = getShockerById(mod.targetPlayerId);
      if (guaranteed && !roundState.guaranteedTargets.some(s => String(s.id) === String(guaranteed.id))) {
        roundState.guaranteedTargets.push(guaranteed);
        markRoundModifierConsumed(roundState, mod, "guaranteed pick applied");
        log(`Guaranteed pick active: ${guaranteed.name} will be included this round.`);
      }
    }
    if (mod.type === "chaosNextRound") {
      roundState.equalFateWeights = true;
      roundState.disableTargetTypes = roundState.disableTargetTypes || new Set();
      roundState.disableTargetTypes.add("safe");
      roundState.targetMultipliers.push({ targetType: "all", multiplier: 80 });
      roundState.forceEqualTargetWeights = true;
      markRoundModifierConsumed(roundState, mod, "chaos applied");
      log(`Chaos token activated by ${getShockerName(mod.playerId, "a player")}.`);
    }
    if (Number(mod.targetWeightMultiplier || 1) !== 1 && mod.targetPlayerId) {
      roundState.targetMultipliers.push({ targetId: String(mod.targetPlayerId), multiplier: Number(mod.targetWeightMultiplier) });
      log(`Pending modifier: target weight x${Number(mod.targetWeightMultiplier)} for ${getShockerName(mod.targetPlayerId, mod.targetPlayerId)}.`);
    }
  }

  if (roundState.guaranteedTargets?.length) {
    const guaranteed = Array.from(new Map(roundState.guaranteedTargets.map(s => [String(s.id), s])).values());
    if (roundState.forcedTarget?.type === "all") {
      log("Guaranteed picks are included by SHOCK ALL.");
    } else if (roundState.forcedTarget?.type === "player" && roundState.forcedTarget.shocker) {
      const combined = Array.from(new Map([roundState.forcedTarget.shocker, ...guaranteed].map(s => [String(s.id), s])).values());
      roundState.forcedTarget = { type: combined.length > 1 ? "multi" : "player", label: combined.map(s => s.name).join(" + "), shocker: combined[0], shockers: combined, weight: 1 };
    } else {
      roundState.forcedTarget = { type: guaranteed.length > 1 ? "multi" : "player", label: guaranteed.map(s => s.name).join(" + "), shocker: guaranteed[0], shockers: guaranteed, weight: 1 };
    }
  }
}

function applyPendingModifiersAfterTarget(roundState, targetPicked, targets) {
  const mods = roundState.pendingRoundModifiers || [];
  targets = Array.from(new Map((targets || []).filter(Boolean).map(t => [t.id, t])).values());
  for (const mod of mods) {
    if (mod.type === "bodyguardNextRound") {
      const protectedId = String(mod.targetPlayerId || "");
      const bodyguard = getShockerById(mod.bodyguardPlayerId);
      const protectedPlayer = getShockerById(protectedId);
      const selectedProtected = targets.some(t => String(t.id) === protectedId);
      const alreadyRedirected = targetPicked?.bodyguardRedirect && String(targetPicked?.originalShocker?.id || "") === protectedId;
      if (bodyguard && selectedProtected) {
        targets = targets.filter(t => String(t.id) !== protectedId);
        if (!targets.some(t => String(t.id) === String(bodyguard.id))) targets.push(bodyguard);
        const redirectInfo = { bodyguardRedirect: true, originalShocker: protectedPlayer, bodyguardShocker: bodyguard };
        targetPicked = targetPicked?.type === "all"
          ? { ...targetPicked, ...redirectInfo }
          : { type: "player", label: protectedPlayer?.name || targetPicked?.label || "Protected", shocker: protectedPlayer || targetPicked?.shocker, weight: 1, ...redirectInfo };
        markRoundModifierConsumed(roundState, mod, "bodyguard redirected");
        log(`${bodyguard.name} bodyguards ${protectedPlayer?.name || protectedId}.`);
      } else if (alreadyRedirected && bodyguard) {
        targets = [bodyguard];
        markRoundModifierConsumed(roundState, mod, "bodyguard redirected");
        log(`${bodyguard.name} bodyguards ${protectedPlayer?.name || protectedId}.`);
      }
    }
    if ((mod.type === "mercyNextRound" || mod.type === "blessingNextRound") && mod.targetPlayerId && targets.some(t => t.id === String(mod.targetPlayerId))) {
      const cap = normalizeFateCap(mod.capFateMax || "low");
      if (cap !== null) roundState.capFateMax = roundState.capFateMax === null ? cap : Math.min(roundState.capFateMax, cap);
      if (Number(mod.valueOffset || 0)) roundState.valueOffset += Number(mod.valueOffset || 0);
      markRoundModifierConsumed(roundState, mod, "blessing/mercy applied");
      log(`Blessing/Mercy applied to ${mod.targetPlayerId}.`);
    }
    if (mod.type === "curseNextRound" && mod.targetPlayerId && targets.some(t => t.id === String(mod.targetPlayerId))) {
      roundState.valueOffset += Number(mod.valueOffset || 10);
      markRoundModifierConsumed(roundState, mod, "curse applied");
      log(`Curse applied to ${mod.targetPlayerId}.`);
    }
  }
  return { targetPicked, targets };
}

async function pollHostSpinnerCommands() {
  try {
    const res = await fetch("/api/host/spinner-commands", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return;
    for (const cmd of data.commands || []) {
      if (cmd.command === "pause") { hostSpinPaused = true; setMainResult("Paused by host"); log("Host command: pause."); }
      if (cmd.command === "resume") { hostSpinPaused = false; setMainResult("Ready"); log("Host command: resume."); }
      if (cmd.command === "spin") {
        log("Host command: spin requested.");
        if (!spinBtn.disabled && !hostSpinPaused) spinRound();
      }
    }
    refreshMainGameStatePanel();
  } catch {}
}

function startHostCommandPolling() {
  if (hostCommandPollTimer) return;
  hostCommandPollTimer = setInterval(pollHostSpinnerCommands, 1000);
}
