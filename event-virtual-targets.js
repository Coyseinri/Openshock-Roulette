// OSR virtual target event effects
// Generic support for event-card effects that add temporary no-hit targets to the target wheel.

(() => {
  if (window.__osrVirtualTargetEffectsLoaded) return;
  window.__osrVirtualTargetEffectsLoaded = true;

  let virtualPick = null;
  let virtualPickRound = null;

  function normalizeVirtualTarget(effect) {
    const name = String(effect.name || effect.label || "Virtual Target").trim() || "Virtual Target";
    const id = String(effect.id || `virtual-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).trim();
    const weight = Math.max(1, Math.round(Number(effect.weight ?? 100)));
    const resultText = String(effect.resultText || `${name} was selected. No real player is hit.`);

    return {
      type: "safe",
      label: name,
      weight,
      virtual: true,
      virtualTarget: true,
      virtualId: id,
      virtualName: name,
      resultText
    };
  }

  const originalApplyEventEffects = applyEventEffects;
  applyEventEffects = function(card, roundState) {
    originalApplyEventEffects(card, roundState);

    for (const effect of getEventEffects(card)) {
      if (effect.type !== "addVirtualTarget") continue;
      roundState.virtualTargets = roundState.virtualTargets || [];
      const target = normalizeVirtualTarget(effect);
      roundState.virtualTargets.push(target);
      showEventResult(`${target.virtualName} was added to the target wheel.`);
    }
  };

  const originalBuildTargetSegmentsForRound = buildTargetSegmentsForRound;
  buildTargetSegmentsForRound = function(roundState) {
    const segments = originalBuildTargetSegmentsForRound(roundState);
    const virtualTargets = Array.isArray(roundState?.virtualTargets) ? roundState.virtualTargets : [];

    if (!virtualTargets.length) return segments;

    const baseIndex = segments.length;
    return [
      ...segments,
      ...virtualTargets.map((target, index) => ({
        ...target,
        colorIndex: baseIndex + index
      }))
    ].filter(s => Number(s.weight || 0) > 0);
  };

  const originalWeightedPick = weightedPick;
  weightedPick = function(items) {
    const picked = originalWeightedPick(items);

    if (picked?.virtualTarget) {
      virtualPick = {
        id: picked.virtualId || picked.id || "virtual-target",
        name: picked.virtualName || picked.label || "Virtual Target",
        resultText: picked.resultText || `${picked.label || "Virtual target"} was selected. No real player is hit.`
      };
      virtualPickRound = roundNumber;
    }

    return picked;
  };

  const originalRecordSafeRoundForActivePlayers = recordSafeRoundForActivePlayers;
  recordSafeRoundForActivePlayers = function() {
    if (virtualPick && virtualPickRound === roundNumber) return;
    return originalRecordSafeRoundForActivePlayers();
  };

  const originalPostRoundResult = postRoundResult;
  postRoundResult = async function(payload) {
    if (virtualPick && payload?.roundNumber === virtualPickRound && payload?.resultType === "safe") {
      return originalPostRoundResult({
        ...payload,
        resultType: "virtual",
        targets: [],
        virtualTarget: {
          id: virtualPick.id,
          name: virtualPick.name,
          resultText: virtualPick.resultText
        }
      });
    }

    return originalPostRoundResult(payload);
  };

  const originalSpinRound = spinRound;
  spinRound = async function(...args) {
    virtualPick = null;
    virtualPickRound = null;

    try {
      return await originalSpinRound.apply(this, args);
    } finally {
      if (virtualPick && virtualPickRound === roundNumber) {
        targetResult.textContent = `${virtualPick.name} selected`;
        fateResult.textContent = "No fate spin.";
        setMainResult(virtualPick.resultText, "safe");
        log(`Round ${roundNumber}: ${virtualPick.resultText}`);
        saveSessionState("virtual target round");
      }

      virtualPick = null;
      virtualPickRound = null;
    }
  };

  const spinButton = document.getElementById("spinBtn");
  if (spinButton) spinButton.onclick = spinRound;
})();
