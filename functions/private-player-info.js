// OSR private player info panel override
// Loaded after ui.js to keep QR links safe while hiding objective/role/token data.

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
    const links = linksData.links || [];
    const playerName = id => links.find(l => String(l.playerId) === String(id))?.name || id || "unknown";
    const pendingMods = session.pendingRoundModifiers || [];
    const audienceVotes = session.audienceVotes || [];
    const objectiveEvents = (session.completedObjectiveEvents || []).filter(e => !e.seen);

    let html = `<div class="objectiveToolbar">
      <button class="secondary" id="refreshObjectivesBtn" type="button">Refresh</button>
    </div>`;
    let stateHtml = ``;
    let privateHtml = `<div class="objectiveToolbar">
      <button class="good" id="generateObjectivesBtn" type="button">Generate / reroll objectives</button>
    </div>`;

    html += `<div class="objectiveNote">Player pages + QR: <strong>${linksData.enabled ? "enabled" : "disabled"}</strong> · Base URL: <code>${escapeHtml(linksData.publicBaseUrl || "")}</code></div>`;

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

    html += `<h4>Host / audience links</h4><div class="playerLinkGrid">`;
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
    const sessionStats = links.map(link => ({ link, stats: session.playerStats?.[link.playerId] || {} }))
      .sort((a, b) => Number(b.stats.shocked || 0) - Number(a.stats.shocked || 0));
    if (!sessionStats.length) stateHtml += `<div class="objectiveNote">No session stats yet.</div>`;
    else {
      stateHtml += `<div class="pendingActionList">`;
      for (const item of sessionStats) {
        stateHtml += `<div class="pendingAction"><strong>${escapeHtml(item.link.name)}</strong> · Shocked ${escapeHtml(item.stats.shocked || 0)} · Selected ${escapeHtml(item.stats.selected || 0)} · Vibes ${escapeHtml(item.stats.vibes || 0)}</div>`;
      }
      stateHtml += `</div>`;
    }

    html += `<h4>Player links / QR codes</h4><div class="playerLinkGrid">`;
    for (const link of links) {
      const multiplier = Number(session.playerMultipliers?.[link.playerId] ?? playerMultipliers?.[link.playerId] ?? 100);
      html += `<div class="playerLinkCard">
        <div class="playerLinkHeader"><strong>${escapeHtml(link.name)}</strong><span>QR / link</span></div>
        <div class="objectiveMini"><strong>Multiplier:</strong> <input class="playerMultiplierInput" type="number" min="0" max="100" step="1" data-player-id="${escapeHtml(link.playerId)}" value="${escapeHtml(Math.max(0, Math.min(100, Math.round(Number.isFinite(multiplier) ? multiplier : 100))))}">%</div>
        <div class="playerUrl"><input readonly value="${escapeHtml(link.url)}"></div>
        ${link.qrDataUrl ? `<img class="qrCode" alt="QR for ${escapeHtml(link.name)}" src="${link.qrDataUrl}">` : `<div class="qrDisabled">QR disabled</div>`}
      </div>`;
    }
    html += `</div>`;

    if (objectiveEvents.length) {
      privateHtml += `<h4>Objective completions</h4><div class="pendingActionList">`;
      for (const e of objectiveEvents) {
        privateHtml += `<div class="pendingAction objectiveCompletePopup"><strong>${escapeHtml(playerName(e.playerId))}</strong> completed <strong>${escapeHtml(e.title)}</strong> (+${escapeHtml(e.rewardPoints || 0)} pts) <button class="secondary ackObjectiveBtn" type="button" data-id="${escapeHtml(e.id)}">Acknowledge</button></div>`;
      }
      privateHtml += `</div>`;
    }

    privateHtml += `<h4>Private player info</h4><div class="playerLinkGrid">`;
    for (const link of links) {
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
      privateHtml += `<div class="playerLinkCard">
        <div class="playerLinkHeader"><strong>${escapeHtml(link.name)}</strong><span>${Number(points[link.playerId] || 0)} pts</span></div>
        <div class="objectiveMini"><strong>Role:</strong> ${escapeHtml(role)}</div>
        <div class="objectiveMini"><strong>Tokens:</strong> ${tokenText}</div>
        <div class="objectiveMini">${objectiveText}</div>
      </div>`;
    }
    privateHtml += `</div>`;

    html += `<details class="dangerZone privatePlayerInfoDetails">
      <summary>Private player info</summary>
      <p class="muted">Hidden roles, objectives, tokens, points and progress. Keep this closed when players can see the main screen.</p>
      ${privateHtml}
    </details>`;

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
