var DIAGNOSTIC_KNOWN_EVENT_EFFECT_TYPES = [
  "suppressNormalActivation",   "activateTargetDevices", "activateTargetToys", "activateTargetShocks", "activateAllToys", "activateOtherToys",
  "activateRandomToyPlayers", "activateRandomShockPlayers", "sequencePlayers", "devicePowerModifier", "deviceDurationModifier", "toyTemplateOverride",
    "manualTargetByLastShocked", "manualTargetByHost", "groupVoteTarget",
  "excludeLastTarget", "excludeLastShocked", "forcePreviousTarget", "forceLastShockedTarget",
  "forceLeastShockedTarget", "forceMostShockedTarget", "forceLeastSelectedTarget", "forceMostSelectedTarget",
  "forceLeastVibedTarget", "forceMostVibedTarget", "forceLowestIntensityTarget", "forceHighestIntensityTarget",
  "forceLongestNotSelectedTarget", "forceLongestNotShockedTarget", "forceTargetBySelector",
  "multiplyTargetWeight", "disableTargetType", "addVirtualTarget", "doubleTarget", "addRandomTargets",
  "forceAllTargets", "sharePain", "bodyguard", "duel", "chooseFateByTarget", "chooseTargetByTarget",
  "targetChoosesOpponent", "forceVibrateOnly", "forceControlType", "disableFate", "multiplyFateWeight",
  "capFateMax", "capFateCategory", "doubleSafeWeight", "disableSafe", "noMercy", "mercyRound",
  "forceFate", "equalFateWeights", "invertFateWeights", "forceRandomFate", "guaranteedDoubleHit",
  "setDoubleHitChance", "valueMultiplier", "valueOffset", "lastWords", "mutualDestruction",
  "removeSafe", "removeSAFE", "disableSafeTarget", "disableTargetSafe", "noSafeTarget",
  "forceVibe", "vibeOnly", "vibrateOnly"
];

var DIAGNOSTIC_KNOWN_OBJECTIVE_TYPES = [
  "selected", "shocked", "vibes", "safe", "allTargeted", "bodyguards", "cursesUsed",
  "chaosUsed", "tokensBought", "tokensOwned", "highPlusSurvived", "eventCardsExperienced",
  "sabotageEffects", "redirectedHits", "roundsSinceSelected", "roundsSinceShocked",
  "totalIntensity", "publicProgress", "manual", "rounds", "audienceVotesApproved", "objectiveCompletions"
];

validateDiagnosticEventCards = function validateDiagnosticEventCards(cardsData) {
  const knownEffects = new Set(DIAGNOSTIC_KNOWN_EVENT_EFFECT_TYPES);
  const cards = cardsData?.cards || [];
  const checks = [];
  const warnings = [];
  const duplicates = duplicateIds(cards);
  const duplicateTitles = Object.entries(cards.reduce((acc, card) => {
    const title = String(card?.title || "").trim().toLowerCase();
    if (title) (acc[title] ||= []).push(card?.id || "unknown");
    return acc;
  }, {})).filter(([, ids]) => ids.length > 1);
  const functional = Object.entries(cards.reduce((acc, card) => {
    const signature = JSON.stringify({ targetWheel: Boolean(card?.targetWheel), fateWheel: Boolean(card?.fateWheel), waitOnly: Boolean(card?.waitOnly), effects: card?.effects || [] });
    (acc[signature] ||= []).push(card?.id || "unknown");
    return acc;
  }, {})).filter(([, ids]) => ids.length > 1);
  checks.push({ id: "event-duplicate-ids", label: "No duplicate event card IDs", ok: duplicates.length === 0, severity: diagnosticSeverity(duplicates.length === 0), details: duplicates });
  checks.push({ id: "event-duplicate-titles", label: "No duplicate event card titles", ok: duplicateTitles.length === 0, severity: diagnosticSeverity(duplicateTitles.length === 0), details: duplicateTitles });
  checks.push({ id: "event-functional-duplicates", label: "No exact functional duplicate event cards", ok: functional.length === 0, severity: functional.length ? "warning" : "ok", details: functional });

  for (const card of cards) {
    const cardId = card?.id || "unknown";
    if (!card?.title) warnings.push(`Event card ${cardId} has no title.`);
    if (!card?.description && !card?.text) warnings.push(`Event card ${cardId} has no description.`);
    if (clampInt(card?.weight ?? 0, 0, 1000000) === 0 && card?.enabled !== false) warnings.push(`Event card ${cardId} is enabled but has weight 0.`);
    const effects = Array.isArray(card?.effects) ? card.effects : [];
    for (const effect of effects) {
      const type = String(effect?.type || "").trim();
      if (!type) warnings.push(`Event card ${cardId} contains an effect without a type.`);
      else if (!knownEffects.has(type)) warnings.push(`Event card ${cardId} references unknown effect type '${type}'.`);
      if (type === "sequencePlayers") {
        if (!["any", "toy", "shock"].includes(String(effect.provider || "any").toLowerCase())) warnings.push(`Event card ${cardId} has invalid sequencePlayers.provider.`);
        if (!Number.isFinite(Number(effect.count)) || Number(effect.count) < 1 || Number(effect.count) > 50) warnings.push(`Event card ${cardId} has invalid sequencePlayers.count.`);
        if (!Number.isFinite(Number(effect.delayMs)) || Number(effect.delayMs) < 250 || Number(effect.delayMs) > 60000) warnings.push(`Event card ${cardId} has invalid sequencePlayers.delayMs.`);
      }
      if (type === "devicePowerModifier" && (!Number.isFinite(Number(effect.multiplier)) || Number(effect.multiplier) < 0 || Number(effect.multiplier) > 1)) warnings.push(`Event card ${cardId} has invalid devicePowerModifier.multiplier.`);
      if (type === "deviceDurationModifier" && (!Number.isFinite(Number(effect.multiplier)) || Number(effect.multiplier) < 0.1 || Number(effect.multiplier) > 5)) warnings.push(`Event card ${cardId} has invalid deviceDurationModifier.multiplier.`);
      if (["activateRandomToyPlayers", "activateRandomShockPlayers"].includes(type) && effect.count !== undefined && (!Number.isFinite(Number(effect.count)) || Number(effect.count) < 1 || Number(effect.count) > 50)) warnings.push(`Event card ${cardId} has invalid ${type}.count.`);
      if (effect.powerMultiplier !== undefined && (!Number.isFinite(Number(effect.powerMultiplier)) || Number(effect.powerMultiplier) < 0 || Number(effect.powerMultiplier) > 1)) warnings.push(`Event card ${cardId} has invalid ${type}.powerMultiplier.`);
      if (effect.durationMultiplier !== undefined && (!Number.isFinite(Number(effect.durationMultiplier)) || Number(effect.durationMultiplier) < 0.1 || Number(effect.durationMultiplier) > 5)) warnings.push(`Event card ${cardId} has invalid ${type}.durationMultiplier.`);
      if (type === "toyTemplateOverride") {
        const templateId = String(effect.templateId || effect.template || effect.value || "");
        try {
          if (typeof readGameIntifaceTemplates === "function" && !readGameIntifaceTemplates().some(template => String(template.id) === templateId)) warnings.push(`Event card ${cardId} references unknown Toy template '${templateId}'.`);
        } catch {}
      }
    }
  }

  checks.push({ id: "event-effect-types", label: "Event effect types look known", ok: !warnings.some(w => w.includes("unknown effect type") || w.includes("without a type")), severity: warnings.some(w => w.includes("unknown")) ? "warning" : "ok", details: warnings.filter(w => w.includes("effect")) });
  return { total: cards.length, enabled: cards.filter(c => c?.enabled !== false).length, checks, warnings };
};

validateDiagnosticObjectives = function validateDiagnosticObjectives(objectivesData) {
  const knownObjectiveTypes = new Set(DIAGNOSTIC_KNOWN_OBJECTIVE_TYPES);
  const privateObjectives = objectivesData?.objectives || [];
  const publicObjectives = objectivesData?.publicObjectives || [];
  const hiddenRoles = objectivesData?.hiddenRoles || [];
  const checks = [];
  const warnings = [];
  const privateDuplicates = duplicateIds(privateObjectives);
  const publicDuplicates = duplicateIds(publicObjectives);
  const roleDuplicates = duplicateIds(hiddenRoles);
  checks.push({ id: "objective-duplicate-ids", label: "No duplicate private objective IDs", ok: privateDuplicates.length === 0, severity: diagnosticSeverity(privateDuplicates.length === 0), details: privateDuplicates });
  checks.push({ id: "public-objective-duplicate-ids", label: "No duplicate public objective IDs", ok: publicDuplicates.length === 0, severity: diagnosticSeverity(publicDuplicates.length === 0), details: publicDuplicates });
  checks.push({ id: "role-duplicate-ids", label: "No duplicate hidden role IDs", ok: roleDuplicates.length === 0, severity: diagnosticSeverity(roleDuplicates.length === 0), details: roleDuplicates });

  const inspectObjective = (objective, label) => {
    const id = objective?.id || "unknown";
    if (!objective?.title) warnings.push(`${label} ${id} has no title.`);
    if (objective?.enabled !== false && clampInt(objective?.target ?? 1, 0, 1000000) <= 0) warnings.push(`${label} ${id} has an impossible target.`);
    const type = String(objective?.type || "").trim();
    if (type && !knownObjectiveTypes.has(type)) warnings.push(`${label} ${id} uses unknown type '${type}'.`);
  };
  privateObjectives.forEach(o => inspectObjective(o, "Private objective"));
  publicObjectives.forEach(o => inspectObjective(o, "Public objective"));
  for (const role of hiddenRoles) {
    const id = role?.id || "unknown";
    if (!role?.title) warnings.push(`Hidden role ${id} has no title.`);
    const trigger = String(role?.triggerType || "").trim();
    if (trigger && !knownObjectiveTypes.has(trigger)) warnings.push(`Hidden role ${id} uses unknown triggerType '${trigger}'.`);
    if (role?.enabled !== false && clampInt(role?.triggerTarget ?? 1, 0, 1000000) <= 0) warnings.push(`Hidden role ${id} has an impossible trigger target.`);
  }

  checks.push({ id: "objective-types", label: "Objective and role types look known", ok: !warnings.some(w => w.includes("unknown type") || w.includes("unknown triggerType")), severity: "warning", details: warnings.filter(w => w.includes("unknown")) });
  return { privateCount: privateObjectives.length, publicCount: publicObjectives.length, hiddenRoleCount: hiddenRoles.length, checks, warnings };
};
