function getHostDashboardDetailsKey(details) {
  if (!details) return "";
  if (details.id) return `id:${details.id}`;

  const summary = details.querySelector(":scope > summary");
  const summaryText = (summary?.textContent || "").replace(/\s+/g, " ").trim();
  const classText = Array.from(details.classList || []).sort().join(".");
  return `details:${classText}:${summaryText}`;
}

function captureHostDashboardUiState() {
  const openDetails = new Set();
  document.querySelectorAll("details").forEach(details => {
    if (details.open) {
      const key = getHostDashboardDetailsKey(details);
      if (key) openDetails.add(key);
    }
  });

  return {
    openDetails,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  };
}

function restoreHostDashboardUiState(state) {
  if (!state) return;

  document.querySelectorAll("details").forEach(details => {
    const key = getHostDashboardDetailsKey(details);
    if (key) details.open = state.openDetails.has(key);
  });

  requestAnimationFrame(() => {
    window.scrollTo(state.scrollX || 0, state.scrollY || 0);
  });
}

async function loadPlayerObjectivePanel() {
  const panel = document.getElementById("objectivePanelBody");
  if (!panel) return;

  const uiState = captureHostDashboardUiState();

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
    const links = linksData.links || [];
    const assignments = session.objectiveAssignments || {};
    const defs = new Map((objectivesData.definitions?.objectives || []).map(o => [o.id, o]));
    const points = session.playerPoints || {};
    const tokens = session.playerTokens || {};
    const playerName = id => links.find(l => String(l.playerId) === String(id))?.name || id || "unknown";

    let html = `<div class="objectiveToolbar"><button class="secondary" id="refreshObjectivesBtn" type="button">Refresh</button></div>`;
    html += `<div class="objectiveNote">Player pages + QR: <strong>${linksData.enabled ? "enabled" : "disabled"}</strong> · Base URL: <code>${escapeHtml(linksData.publicBaseUrl || "")}</code></div>`;

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

    html += `<h4>Player links / QR codes</h4><div class="playerLinkGrid">`;
    for (const link of links) {
      const multiplier = Number(session.playerMultipliers?.[link.playerId] ?? playerMultipliers?.[link.playerId] ?? 100);
      const deviceMultipliers = Array.isArray(link.devices) && link.devices.length > 1
        ? link.devices.map(d => {
            const dm = Number(session.playerMultipliers?.[d.id] ?? playerMultipliers?.[d.id] ?? 100);
            const safeDm = Math.max(0, Math.min(100, Math.round(Number.isFinite(dm) ? dm : 100)));
            return `<div class="objectiveMini"><strong>${escapeHtml(d.memberName || d.name)}:</strong> <input class="playerMultiplierInput" type="number" min="0" max="100" step="1" data-player-id="${escapeHtml(d.id)}" value="${escapeHtml(safeDm)}">%</div>`;
          }).join("")
        : `<div class="objectiveMini"><strong>Multiplier:</strong> <input class="playerMultiplierInput" type="number" min="0" max="100" step="1" data-player-id="${escapeHtml(link.playerId)}" value="${escapeHtml(Math.max(0, Math.min(100, Math.round(Number.isFinite(multiplier) ? multiplier : 100))))}">%</div>`;
      html += `<div class="playerLinkCard">
        <div class="playerLinkHeader"><strong>${escapeHtml(link.name)}</strong><span>${link.isGrouped ? "group link" : "QR / link"}</span></div>
        ${deviceMultipliers}
        <div class="playerUrl"><input readonly value="${escapeHtml(link.url)}"></div>
        ${link.qrDataUrl ? `<img class="qrCode" alt="QR for ${escapeHtml(link.name)}" src="${link.qrDataUrl}">` : `<div class="qrDisabled">QR disabled</div>`}
      </div>`;
    }
    html += `</div>`;

    let privateHtml = `<div class="objectiveToolbar"><button class="good" id="generateObjectivesBtn" type="button">Generate / reroll objectives</button></div>`;
    const objectiveEvents = (session.completedObjectiveEvents || []).filter(e => !e.seen);
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
      const objectiveText = list.length ? list.map(a => {
        const def = defs.get(a.objectiveId);
        const title = def?.title || a.objectiveId;
        return `${escapeHtml(title)}: ${a.progress ?? 0}/${a.target ?? def?.target ?? "?"}${a.completed ? " ✅" : ""}`;
      }).join("<br>") : "No objective assigned";
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
      <p class="muted">Spoilers: roles, objectives, tokens, points and progress live here.</p>
      ${privateHtml}
    </details>`;

    panel.innerHTML = html;

    renderGameStatePanelFromSession(session, links, playerName);
    restoreHostDashboardUiState(uiState);
    bindObjectivePanelButtons();
  } catch (err) {
    panel.innerHTML = `<div class="warningText">Could not load player/objective panel: ${escapeHtml(err.message)}</div>`;
    const gameStatePanel = document.getElementById("gameStatePanelBody");
    if (gameStatePanel) gameStatePanel.innerHTML = `<div class="warningText">Could not load game state: ${escapeHtml(err.message)}</div>`;
    restoreHostDashboardUiState(uiState);
  }
}

function renderGameStatePanelFromSession(session, links, playerName) {
  const gameStatePanel = document.getElementById("gameStatePanelBody");
  if (!gameStatePanel) return;

  let html = `<h4>Pending Next Round effects</h4>`;
  const pendingMods = session.pendingRoundModifiers || [];
  if (!pendingMods.length) html += `<div class="objectiveNote">No pending next-round effects.</div>`;
  else {
    html += `<div class="pendingActionList">`;
    for (const mod of pendingMods) {
      html += `<div class="pendingAction"><strong>${escapeHtml(mod.type)}</strong> ${mod.targetPlayerId ? `→ ${escapeHtml(playerName(mod.targetPlayerId))}` : ""}${mod.bodyguardPlayerId ? ` · Bodyguard: ${escapeHtml(playerName(mod.bodyguardPlayerId))}` : ""}</div>`;
    }
    html += `</div>`;
  }

  html += `<h4>Audience votes</h4>`;
  const openVotes = (session.audienceVotes || []).filter(v => v.status === "open");
  if (!openVotes.length) html += `<div class="objectiveNote">No open audience votes.</div>`;
  else {
    html += `<div class="pendingActionList">`;
    for (const vote of openVotes) {
      html += `<div class="pendingAction"><strong>${escapeHtml(vote.type)}</strong>${vote.tokenType ? ` (${escapeHtml(vote.tokenType)} token)` : ""} → ${escapeHtml(playerName(vote.targetPlayerId))} · Votes: ${escapeHtml(vote.count || 0)}
        <button class="good approveVoteBtn" type="button" data-id="${escapeHtml(vote.id)}">Approve</button>
        <button class="danger rejectVoteBtn" type="button" data-id="${escapeHtml(vote.id)}">Reject</button></div>`;
    }
    html += `</div>`;
  }

  html += `<h4>Pending actions</h4>`;
  const pending = (session.pendingPlayerActions || []).filter(a => a.status === "pending");
  if (!pending.length) html += `<div class="objectiveNote">No pending player/audience actions.</div>`;
  else {
    html += `<div class="pendingActionList">`;
    for (const action of pending) {
      html += `<div class="pendingAction"><strong>${escapeHtml(action.type)}</strong>${action.tokenType ? ` (${escapeHtml(action.tokenType)} token)` : ""} from ${escapeHtml(playerName(action.playerId || action.bodyguardPlayerId) || action.source || "unknown")} ${action.targetPlayerId ? `→ ${escapeHtml(playerName(action.targetPlayerId))}` : ""}
        <button class="good approveActionBtn" type="button" data-id="${escapeHtml(action.id)}">Approve</button>
        <button class="danger rejectActionBtn" type="button" data-id="${escapeHtml(action.id)}">Reject</button>
      </div>`;
    }
    html += `</div>`;
  }

  html += `<h4>Session stats</h4>`;
  const sessionStats = links.map(link => ({ link, stats: session.playerStats?.[link.playerId] || {} })).sort((a, b) => Number(b.stats.shocked || 0) - Number(a.stats.shocked || 0));
  if (!sessionStats.length) html += `<div class="objectiveNote">No session stats yet.</div>`;
  else {
    html += `<div class="pendingActionList">`;
    for (const item of sessionStats) {
      html += `<div class="pendingAction"><strong>${escapeHtml(item.link.name)}</strong> · Shocked ${escapeHtml(item.stats.shocked || 0)} · Selected ${escapeHtml(item.stats.selected || 0)} · Vibes ${escapeHtml(item.stats.vibes || 0)}</div>`;
    }
    html += `</div>`;
  }

  gameStatePanel.innerHTML = html;
}

function bindObjectivePanelButtons() {
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
}
