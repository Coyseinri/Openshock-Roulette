
function normalizeEventCategory(card) {
  const raw = String(card?.category || card?.type || card?.tone || "").toLowerCase();
  if (["good", "beneficial", "mercy", "safe"].includes(raw)) return "good";
  if (["evil", "bad", "punishment", "red"].includes(raw)) return "evil";
  if (["chaos", "wild", "random"].includes(raw)) return "chaos";
  if (["neutral", "mixed", "orange"].includes(raw)) return "neutral";
  const text = `${card?.id || ""} ${card?.title || ""} ${card?.description || ""}`.toLowerCase();
  if (text.includes("safe") || text.includes("mercy") || text.includes("escape")) return "good";
  if (text.includes("all") || text.includes("double") || text.includes("death") || text.includes("brutal")) return "evil";
  if (text.includes("random") || text.includes("swap") || text.includes("reverse")) return "chaos";
  return "neutral";
}

function getEventRuntimeConfig() {
  const displayDurationMs = Math.max(0, numberWithDefault(config?.eventCards?.displayDurationMs ?? eventCardsConfig?.displayDurationMs, 4000));
  return {
    enabled: Boolean(config?.eventCards?.enabled ?? eventCardsConfig?.enabled ?? false) && eventCardsConfig?.enabled !== false,
    chancePercent: Math.max(0, Math.min(100, numberWithDefault(config?.eventCards?.chancePercent ?? eventCardsConfig?.chancePercent, 18))),
    displayDurationMs,
    cards: (eventCardsConfig?.cards || []).filter(c => c && c.enabled !== false)
  };
}

function getTriggeredEventDisplayDuration(card) {
  const ec = getEventRuntimeConfig();
  const raw = card?.displayDurationMs ?? card?.durationMs ?? card?.displayMs ?? ec.displayDurationMs;
  const parsed = Math.max(0, numberWithDefault(raw, ec.displayDurationMs || 4000));
  return Math.max(1200, parsed || 4000);
}

function rollEventCard(force = false, forcedCardId = null) {
  const ec = getEventRuntimeConfig();

  if (!ec.enabled && !force) {
    log("Event card roll skipped: event cards are disabled.");
    return null;
  }

  if (!ec.cards.length) {
    log("Event card roll skipped: no enabled event cards found.");
    return null;
  }

  if (forcedCardId) {
    const picked = ec.cards.find(c => String(c.id) === String(forcedCardId));
    if (picked) {
      log(`Event card forced by host. Picked specific card: ${picked.title || picked.id}.`);
      return picked;
    }
    log(`Host requested unknown event card '${forcedCardId}'. Falling back to weighted forced event roll.`);
  }

  const roll = Math.random() * 100;
  if (!force && roll >= ec.chancePercent) {
    log(`Event card roll missed: ${roll.toFixed(1)} >= ${ec.chancePercent}%.`);
    return null;
  }

  const picked = weightedPick(ec.cards.map(c => ({ ...c, weight: Math.max(0, Number(c.weight ?? 1)) })));
  if (force) log(`Event card forced by host. Picked: ${picked.title || picked.id}.`);
  else log(`Event card roll hit: ${roll.toFixed(1)} < ${ec.chancePercent}%. Picked: ${picked.title || picked.id}.`);
  return picked;
}

function getEventEffects(card) {
  if (!card) return [];
  const rawEffects = [];
  if (Array.isArray(card.effects)) rawEffects.push(...card.effects);
  else if (card.effects && typeof card.effects === "object") rawEffects.push(card.effects);

  if (Array.isArray(card.effect)) rawEffects.push(...card.effect);
  else if (card.effect) rawEffects.push(card.effect);

  if (Array.isArray(card.modifiers)) rawEffects.push(...card.modifiers);
  else if (card.modifiers && typeof card.modifiers === "object") rawEffects.push(card.modifiers);

  if (card.type) rawEffects.push({ type: card.type });

  return rawEffects.map(effect => {
    if (!effect) return null;
    if (typeof effect === "string") return { type: effect };
    if (typeof effect !== "object") return null;
    const type = effect.type || effect.name || effect.action || effect.effectType;
    if (!type) return null;
    return { ...effect, type: String(type) };
  }).filter(Boolean);
}

function cardAffects(card, wheel) {
  const effects = getEventEffects(card);
  if (wheel === "target" && card?.targetWheel) return true;
  if (wheel === "fate" && card?.fateWheel) return true;

  const targetEffects = [
    "manualTargetByLastShocked", "manualTargetByHost", "excludeLastTarget", "excludeLastShocked",
    "forcePreviousTarget", "forceLastShockedTarget", "doubleTarget", "addRandomTargets", "forceAllTargets",
    "forceLeastShockedTarget", "forceMostShockedTarget", "forceLeastSelectedTarget", "forceMostSelectedTarget",
    "forceLeastVibedTarget", "forceMostVibedTarget", "forceLowestIntensityTarget", "forceHighestIntensityTarget",
    "forceLongestNotSelectedTarget", "forceLongestNotShockedTarget", "forceTargetBySelector",
    "multiplyTargetWeight", "disableTargetType", "addVirtualTarget", "sharePain", "bodyguard", "duel", "groupVoteTarget",
    "chooseTargetByTarget", "targetChoosesOpponent"
  ];
  const fateEffects = [
    "forceVibrateOnly", "forceControlType", "disableFate", "multiplyFateWeight", "capFateMax",
    "capFateCategory", "doubleSafeWeight", "disableSafe", "noMercy", "mercyRound", "forceFate",
    "equalFateWeights", "invertFateWeights", "forceRandomFate", "chooseFateByTarget", "guaranteedDoubleHit",
    "setDoubleHitChance", "valueMultiplier", "valueOffset", "lastWords"
  ];

  return effects.some(e => {
    const t = String(e.type || "");
    if (wheel === "target") return targetEffects.includes(t);
    if (wheel === "fate") return fateEffects.includes(t);
    return false;
  });
}

function selectManualTarget(card, picker) {
  return new Promise(resolve => {
    const active = activeShockers();
    if (!active.length) return resolve(null);
    const pickerName = picker?.name || "Host";
    eventPickerLine.textContent = `${pickerName} must pick the next target.`;
    choiceButtons(active.map(s => ({ label: s.name, shocker: s })), opt => {
      const picked = { type: "player", label: opt.shocker.name, shocker: opt.shocker, weight: 1 };
      showEventResult(`${pickerName} picked ${opt.shocker.name}. Target spinner skipped.`);
      resolve(picked);
    });
  });
}

function selectPlayerOption({ pickerName = "Host", prompt = "Pick a player.", candidates = activeShockers(), allowNone = false, noneLabel = "No one" } = {}) {
  return new Promise(resolve => {
    const active = (candidates || []).filter(Boolean);
    eventPickerLine.textContent = prompt.replace("{picker}", pickerName);
    const options = active.map(s => ({ label: s.name, shocker: s }));
    if (allowNone) options.push({ label: noneLabel, shocker: null });
    if (!options.length) return resolve(null);
    choiceButtons(options, opt => {
      resolve(opt.shocker || null);
    });
  });
}

function forceTargetFromShocker(roundState, shocker, labelPrefix = "Target") {
  if (!shocker) return false;
  roundState.forcedTarget = { type: "player", label: shocker.name, shocker, weight: 1 };
  showEventResult(`${labelPrefix}: ${shocker.name}. Target spinner skipped.`);
  return true;
}

async function resolveInteractiveEvent(card, roundState) {
  const effects = getEventEffects(card);
  for (const effect of effects) {
    if (effect.type === "manualTargetByLastShocked") {
      const picker = lastShockedTargets[0];
      if (!picker) {
        showEventResult("No previous shocked player found. Card has no effect this round.");
        continue;
      }
      roundState.forcedTarget = await selectManualTarget(card, picker);
    }
    if (effect.type === "manualTargetByHost" || effect.type === "groupVoteTarget") {
      const pickerName = effect.type === "groupVoteTarget" ? "The group" : "Host";
      roundState.forcedTarget = await selectManualTarget(card, { name: pickerName });
    }
  }
}

async function runPreRoundEvent(pendingRoundModifiers = []) {
  clearActiveEventCardPanel("Checking for event card...");

  const forceEventMod = (pendingRoundModifiers || []).find(m => m && m.type === "forceEventNextRound");
  const forcedCardId = forceEventMod?.eventCardId || forceEventMod?.cardId || null;
  const card = rollEventCard(Boolean(forceEventMod), forcedCardId);

  const roundState = {
    card,
    forcedTarget: null,
    extraTargets: [],
    forceValue: null,
    forceFateKey: null,
    capFateMax: null,
    disabledFateKeys: new Set(),
    fateMultipliers: new Map(),
    targetMultipliers: [],
    excludeTargetIds: new Set(),
    disableTargetTypes: new Set(),
    skipTargetSpin: false,
    doubleHitChanceOverride: null,
    valueMultiplier: 1,
    valueOffset: 0,
    forceAllTargets: false,
    postTargetEffects: [],
    consumedModifierIds: new Set(),
    guaranteedTargets: [],
    virtualTargets: []
  };

  if (forceEventMod) markRoundModifierConsumed(roundState, forceEventMod, forcedCardId ? `forced event card ${forcedCardId}` : "forced event card");
  if (!card) {
    clearActiveEventCardPanel("No event card this round.");
    return roundState;
  }
  activeRoundEvent = card;
  updateEventCardPanel(card);
  showEventOverlay(card);
  const eventEffects = getEventEffects(card);
  log(`Round ${roundNumber}: Event card triggered: ${card.title || card.id}${eventEffects.length ? ` (${eventEffects.map(e => e.type).join(", ")})` : " (no parsed effects)"}`);
  postEventLog({ roundNumber, type: "eventCardTriggered", title: card.title || card.id, description: card.description || card.text || "", metadata: { card, effects: eventEffects } });
  if (!eventEffects.length) showEventResult("This card has no parsed effects. Check event-cards.json for an effects array or type value.");
  await resolveInteractiveEvent(card, roundState);
  applyEventEffects(card, roundState);
  activeRoundEvent = roundState.card || card;
  updateEventCardPanel(activeRoundEvent);
  await waitForEventContinue(getTriggeredEventDisplayDuration(activeRoundEvent));
  hideEventOverlay();
  setMainResult("Preparing target spin...");
  return roundState;
}

function normalizeFateCap(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const match = (config.fateWheel || []).find(f => f.key === value || String(f.name).toLowerCase() === String(value).toLowerCase());
    return match ? Number(match.max) : null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function applyEventEffects(card, roundState) {
  for (const effect of getEventEffects(card)) {
    const originalType = String(effect.type || "");
    if (["removeSafe", "removeSAFE", "disableSafeTarget", "disableTargetSafe", "noSafeTarget"].includes(originalType)) effect.type = "disableSafe";
    if (["forceVibe", "vibeOnly", "vibrateOnly"].includes(originalType)) effect.type = "forceVibrateOnly";
    if (effect.type === "forceVibrateOnly" || (effect.type === "forceControlType" && String(effect.controlType || effect.value || "").toLowerCase() === "vibrate")) {
      roundState.forceValue = 0;
      roundState.forceFateKey = effect.fateKey || "vibe";
      showEventResult("Fate result forced to VIBE.");
    }

    if (["disableSafe", "noMercy"].includes(effect.type)) {
      roundState.disableTargetTypes.add("safe");
      roundState.disabledFateKeys.add("safe");
      showEventResult("SAFE-style outcomes are disabled for this round where applicable.");
    }

    if (effect.type === "disableTargetType") roundState.disableTargetTypes.add(effect.targetType || effect.value);
    if (effect.type === "doubleSafeWeight") roundState.targetMultipliers.push({ targetType: "safe", multiplier: 2 });
    if (effect.type === "multiplyTargetWeight") roundState.targetMultipliers.push(effect);
    if (effect.type === "addVirtualTarget") {
      const name = String(effect.name || effect.label || "Virtual Target").trim() || "Virtual Target";
      const id = String(effect.id || `virtual-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).trim();
      const weight = Math.max(1, Math.round(numberWithDefault(effect.weight, 100)));
      const resultText = String(effect.resultText || `${name} was selected. No real player is affected.`);
      roundState.virtualTargets = roundState.virtualTargets || [];
      roundState.virtualTargets.push({
        type: "virtual",
        label: name,
        name,
        virtualName: name,
        virtualId: id,
        virtualTarget: true,
        weight,
        resultText
      });
      showEventResult(`${name} was added to the target wheel.`);
    }

    if (effect.type === "multiplyFateWeight") roundState.fateMultipliers.set(effect.fateKey || effect.fateId, Number(effect.multiplier || 1));
    if (effect.type === "disableFate") roundState.disabledFateKeys.add(effect.fateKey || effect.fateId);
    if (effect.type === "equalFateWeights") roundState.equalFateWeights = true;
    if (effect.type === "invertFateWeights") roundState.invertFateWeights = true;
    if (effect.type === "forceRandomFate") roundState.forceRandomFateKeys = effect.fateKeys || effect.fateIds || effect.values || [];

    if (["capFateMax", "capFateCategory", "mercyRound"].includes(effect.type)) {
      const cap = normalizeFateCap(effect.max ?? effect.value ?? effect.maxValue ?? (effect.type === "mercyRound" ? "medium" : null));
      if (cap !== null) {
        roundState.capFateMax = roundState.capFateMax === null ? cap : Math.min(roundState.capFateMax, cap);
        showEventResult(`Fate capped at ${roundState.capFateMax}.`);
      }
    }

    if (effect.type === "forceFate") roundState.forceFateKey = effect.fateKey || effect.fateId || effect.value;
    if (effect.type === "excludeLastTarget") lastSelectedTargets.forEach(s => roundState.excludeTargetIds.add(s.id));
    if (effect.type === "excludeLastShocked") lastShockedTargets.forEach(s => roundState.excludeTargetIds.add(s.id));
    if (effect.type === "forcePreviousTarget" && lastSelectedTargets[0]) forceTargetFromShocker(roundState, lastSelectedTargets[0], "Previous target");
    if (effect.type === "forceLastShockedTarget" && lastShockedTargets[0]) forceTargetFromShocker(roundState, lastShockedTargets[0], "Last shocked player");
    if (effect.type === "forceLeastShockedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("shocked", "least", roundState.excludeTargetIds), "Least shocked player");
    if (effect.type === "forceMostShockedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("shocked", "most", roundState.excludeTargetIds), "Most shocked player");
    if (effect.type === "forceLeastSelectedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("selected", "least", roundState.excludeTargetIds), "Least selected player");
    if (effect.type === "forceMostSelectedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("selected", "most", roundState.excludeTargetIds), "Most selected player");
    if (effect.type === "forceLeastVibedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("vibes", "least", roundState.excludeTargetIds), "Least vibed player");
    if (effect.type === "forceMostVibedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("vibes", "most", roundState.excludeTargetIds), "Most vibed player");
    if (effect.type === "forceLowestIntensityTarget") forceTargetFromShocker(roundState, pickPlayerByStat("totalIntensity", "least", roundState.excludeTargetIds), "Lowest total intensity player");
    if (effect.type === "forceHighestIntensityTarget") forceTargetFromShocker(roundState, pickPlayerByStat("totalIntensity", "most", roundState.excludeTargetIds), "Highest total intensity player");
    if (effect.type === "forceLongestNotSelectedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("roundsSinceSelected", "most", roundState.excludeTargetIds), "Longest not selected player");
    if (effect.type === "forceLongestNotShockedTarget") forceTargetFromShocker(roundState, pickPlayerByStat("roundsSinceShocked", "most", roundState.excludeTargetIds), "Longest not shocked player");
    if (effect.type === "forceTargetBySelector") forceTargetFromShocker(roundState, pickPlayerBySelector(effect.selector, roundState.excludeTargetIds), effect.labelPrefix || "Selected player");
    if (effect.type === "forceAllTargets") {
      roundState.forcedTarget = { type: "all", label: "ALL", weight: 1 };
      showEventResult("Everyone is selected. Target spinner skipped.");
    }
    if (effect.type === "doubleTarget") roundState.extraRandomTargets = Math.max(roundState.extraRandomTargets || 0, 1);
    if (effect.type === "addRandomTargets") roundState.extraRandomTargets = Math.max(roundState.extraRandomTargets || 0, Math.max(1, Number(effect.count || 1)));

    if (["sharePain", "bodyguard", "duel", "chooseFateByTarget", "chooseTargetByTarget", "targetChoosesOpponent", "lastWords"].includes(effect.type)) {
      roundState.postTargetEffects.push(effect);
    }

    if (effect.type === "guaranteedDoubleHit") roundState.doubleHitChanceOverride = 100;
    if (effect.type === "setDoubleHitChance") roundState.doubleHitChanceOverride = Math.max(0, Math.min(100, Number(effect.percent ?? effect.value ?? 0)));
    if (effect.type === "valueMultiplier") roundState.valueMultiplier = Number(effect.multiplier ?? effect.value ?? 1);
    if (effect.type === "valueOffset") roundState.valueOffset = Number(effect.offset ?? effect.value ?? 0);
  }
}

function segmentMatchesTargetMultiplier(segment, effect) {
  if (!segment || !effect) return false;
  if (effect.targetType && segment.type !== effect.targetType) return false;
  if (effect.targetId && segment.shocker?.id !== effect.targetId) return false;
  if (effect.selector === "lastSelected") return segment.shocker && lastSelectedTargets.some(s => s.id === segment.shocker.id);
  if (effect.selector === "lastShocked") return segment.shocker && lastShockedTargets.some(s => s.id === segment.shocker.id);
  if (effect.selector === "leastShocked") {
    const p = pickPlayerByStat("shocked", "least");
    return segment.shocker?.id === p?.id;
  }
  if (effect.selector === "leastSelected") {
    const p = pickPlayerByStat("selected", "least");
    return segment.shocker?.id === p?.id;
  }
  if (effect.selector === "mostSelected") {
    const p = pickPlayerByStat("selected", "most");
    return segment.shocker?.id === p?.id;
  }
  if (effect.selector === "mostShocked") {
    const p = pickPlayerByStat("shocked", "most");
    return segment.shocker?.id === p?.id;
  }
  if (["leastVibed", "mostVibed", "lowestIntensity", "highestIntensity", "longestNotSelected", "longestNotShocked"].includes(effect.selector)) {
    const p = pickPlayerBySelector(effect.selector);
    return segment.shocker?.id === p?.id;
  }
  return Boolean(effect.targetType || effect.targetId);
}

function buildTargetSegmentsForRound(roundState) {
  let segments = buildTargetSegments();
  if (roundState?.disableTargetSafe) segments = segments.filter(s => s.type !== "safe");
  if (roundState?.disableTargetTypes?.size) segments = segments.filter(s => !roundState.disableTargetTypes.has(s.type));
  if (roundState?.excludeTargetIds?.size) segments = segments.filter(s => s.type !== "player" || !roundState.excludeTargetIds.has(s.originalShocker?.id || s.shocker.id));
  if (roundState?.forceEqualTargetWeights) {
    segments = segments.map(s => s.type === "player" ? { ...s, weight: 1 } : s);
  }
  if (roundState?.safeWeightMultiplier) {
    segments = segments.map(s => s.type === "safe" ? { ...s, weight: Math.max(0, Number(s.weight || 0)) * roundState.safeWeightMultiplier } : s);
  }
  if (roundState?.targetMultipliers?.length) {
    segments = segments.map(seg => {
      let weight = Number(seg.weight || 0);
      for (const effect of roundState.targetMultipliers) {
        if (segmentMatchesTargetMultiplier(seg, effect)) weight *= Number(effect.multiplier ?? 1);
      }
      return { ...seg, weight: Math.max(0, Math.round(weight)) };
    });
  }
  if (roundState?.virtualTargets?.length) {
    const baseIndex = segments.length;
    segments = [
      ...segments,
      ...roundState.virtualTargets.map((target, index) => ({
        ...target,
        colorIndex: baseIndex + index
      }))
    ];
  }
  return segments.filter(s => Number(s.weight || 0) > 0);
}

async function resolvePostTargetEffects(roundState, targetPicked, targets) {
  if (!roundState?.postTargetEffects?.length) return { targetPicked, targets };
  const primary = targets[0] || targetPicked?.shocker || null;

  for (const effect of roundState.postTargetEffects) {
    if (effect.type === "lastWords") {
      showEventOverlay(roundState.card, `${primary?.name || "Target"} gets last words. Continue when ready.`);
      await waitForEventContinue(Number(effect.durationMs || 0));
      hideEventOverlay();
    }

    if (effect.type === "sharePain" || effect.type === "chooseTargetByTarget") {
      const pickerName = primary?.name || "Target";
      showEventOverlay(roundState.card, `${pickerName} must choose another player.`);
      const candidates = activeShockers().filter(s => !targets.some(t => t.id === s.id));
      const picked = await selectPlayerOption({
        pickerName,
        prompt: `${pickerName} must choose another player to join them.`,
        candidates,
        allowNone: effect.allowNone === true,
        noneLabel: "No extra target"
      });
      if (picked) {
        targets.push(picked);
        showEventResult(`${pickerName} picked ${picked.name}.`);
      } else {
        showEventResult(`${pickerName} did not pick an extra target.`);
      }
      await waitForEventContinue(Number(effect.displayDurationMs || 1200));
      hideEventOverlay();
    }

    if (effect.type === "bodyguard") {
      showEventOverlay(roundState.card, `Choose a volunteer to replace ${primary?.name || "the target"}.`);
      const candidates = activeShockers().filter(s => !targets.some(t => t.id === s.id));
      const volunteer = await selectPlayerOption({
        pickerName: "Host",
        prompt: `Choose a bodyguard to take ${primary?.name || "the target"}'s place.`,
        candidates,
        allowNone: true,
        noneLabel: "No volunteer"
      });
      if (volunteer) {
        targets = [volunteer];
        targetPicked = {
          type: "player",
          label: primary?.name || targetPicked?.label || "Original target",
          shocker: primary || targetPicked?.shocker,
          weight: 1,
          bodyguardRedirect: true,
          originalShocker: primary || targetPicked?.shocker,
          bodyguardShocker: volunteer
        };
        showEventResult(`${primary?.name || "The target"} was selected. ${volunteer.name} takes the hit instead.`);
      } else {
        showEventResult("No bodyguard volunteered.");
      }
      await waitForEventContinue(Number(effect.displayDurationMs || 1200));
      hideEventOverlay();
    }

    if (effect.type === "duel" || effect.type === "targetChoosesOpponent") {
      const pickerName = primary?.name || "Target";
      showEventOverlay(roundState.card, `${pickerName} must challenge someone.`);
      const candidates = activeShockers().filter(s => s.id !== primary?.id);
      const opponent = await selectPlayerOption({ pickerName, prompt: `${pickerName} must choose an opponent. Random loser gets the fate.`, candidates });
      if (opponent) {
        const loser = Math.random() < 0.5 ? primary : opponent;
        targets = [loser];
        targetPicked = { type: "player", label: loser.name, shocker: loser, weight: 1 };
        showEventResult(`${primary.name} challenged ${opponent.name}. ${loser.name} lost the duel.`);
      } else {
        showEventResult("No opponent available. Duel has no effect.");
      }
      await waitForEventContinue(Number(effect.displayDurationMs || 1800));
      hideEventOverlay();
    }

    if (effect.type === "chooseFateByTarget") {
      const pickerName = primary?.name || "Target";
      const choices = effect.choices || [
        { label: "Low for sure", fateKey: "low" },
        { label: "Spin the fate wheel", fateKey: null }
      ];
      showEventOverlay(roundState.card, `${pickerName} must choose their fate option.`);
      await new Promise(resolve => {
        choiceButtons(choices.map(c => ({ label: c.label || c.fateKey || "Spin", choice: c })), opt => {
          const choice = opt.choice;
          if (choice.fateKey) roundState.forceFateKey = choice.fateKey;
          if (choice.forceValue !== undefined) roundState.forceValue = Number(choice.forceValue);
          if (choice.valueMultiplier !== undefined) roundState.valueMultiplier = Number(choice.valueMultiplier);
          if (choice.valueOffset !== undefined) roundState.valueOffset = Number(choice.valueOffset);
          if (choice.forceRandomFateKeys || choice.fateKeys) roundState.forceRandomFateKeys = choice.forceRandomFateKeys || choice.fateKeys;
          if (choice.doubleHitChance !== undefined) roundState.doubleHitChanceOverride = Number(choice.doubleHitChance);
          showEventResult(`${pickerName} chose: ${choice.label || "custom option"}.`);
          resolve();
        });
      });
      await waitForEventContinue(Number(effect.displayDurationMs || 1200));
      hideEventOverlay();
    }
  }

  return { targetPicked, targets };
}
