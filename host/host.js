const key = new URLSearchParams(window.location.search).get("key") || "";
let timer = null;
let loading = false;
let latest = null;

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function setStatus(text) { document.getElementById("statusLine").textContent = text; }

function fillPlayerSelect(select, players) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  players.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function renderPlayers(players) {
  fillPlayerSelect(document.getElementById("manualPlayer"), players);
  fillPlayerSelect(document.getElementById("rewardPlayer"), players);
  fillPlayerSelect(document.getElementById("forcePlayer"), players);
}

function renderRewardOptions(economy) {
  const select = document.getElementById("rewardTokenType");
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  (economy?.tokenTypes || ["shield", "mercy", "blessing", "curse", "chaos", "guarantee"]).forEach(type => {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = type;
    select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function renderEventCardOptions(cards) {
  const select = document.getElementById("forceEventCard");
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";

  const sorted = (cards || [])
    .filter(card => card && card.id)
    .slice()
    .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));

  sorted.forEach(card => {
    const opt = document.createElement("option");
    opt.value = card.id;
    const flags = [card.targetWheel ? "target" : null, card.fateWheel ? "fate" : null].filter(Boolean).join(" + ");
    opt.textContent = `${card.title || card.id}${flags ? ` (${flags})` : ""}`;
    opt.title = card.description || "";
    select.appendChild(opt);
  });

  if ([...select.options].some(o => o.value === current)) select.value = current;
  const status = document.getElementById("forceEventStatus");
  if (status && !sorted.length) status.textContent = "No enabled event cards found.";
}

function actionLabel(type) {
  return String(type || "action")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function renderActions(actions) {
  const host = document.getElementById("pendingActions");
  if (!actions.length) {
    host.innerHTML = `<div class="mutedLine">No pending actions.</div>`;
    return;
  }
  host.innerHTML = actions.map(a => `<div class="hostAction">
    <div><strong>${esc(actionLabel(a.type))}${a.tokenType ? ` (${esc(a.tokenType)} token)` : ""}</strong><br><span>${esc(a.playerName)} ${a.targetName ? `→ ${esc(a.targetName)}` : ""}${a.bodyguardName ? ` · Bodyguard: ${esc(a.bodyguardName)}` : ""}</span></div>
    <div class="hostActionButtons">
      <button class="hostButton approve" data-id="${esc(a.id)}">Approve</button>
      <button class="hostButton reject" data-id="${esc(a.id)}">Reject</button>
    </div>
  </div>`).join("");
  document.querySelectorAll(".approve,.reject").forEach(btn => btn.onclick = () => resolveAction(btn.dataset.id, btn.classList.contains("approve")));
}


function renderModifiers(modifiers) {
  const host = document.getElementById("pendingModifiers");
  if (!host) return;
  if (!modifiers.length) { host.innerHTML = `<div class="mutedLine">No pending next-round effects.</div>`; return; }
  host.innerHTML = modifiers.map(m => `<div class="hostAction">
    <div><strong>${esc(actionLabel(m.type))}</strong><br><span>${esc(m.targetName || m.playerName || m.eventTitle || m.eventCardId || "")}${m.bodyguardName ? ` · Bodyguard: ${esc(m.bodyguardName)}` : ""}</span></div>
  </div>`).join("");
}

function renderObjectiveEvents(events) {
  const host = document.getElementById("objectiveEvents");
  if (!host) return;
  const open = (events || []).filter(e => !e.seen);
  if (!open.length) { host.innerHTML = `<div class="mutedLine">No new objective completions.</div>`; return; }
  host.innerHTML = open.map(e => `<div class="hostAction">
    <div><strong>${esc(e.title || "Objective complete")}</strong><br><span>${esc(e.playerId || "Player")} +${esc(e.rewardPoints || 0)} pts</span></div>
    <div class="hostActionButtons"><button class="hostButton ackObjective" data-id="${esc(e.id)}">Acknowledge</button></div>
  </div>`).join("");
  document.querySelectorAll(".ackObjective").forEach(btn => btn.onclick = () => acknowledgeObjectives([btn.dataset.id]));
}

function renderPublicObjectives(objectives) {
  const host = document.getElementById("publicObjectives");
  if (!host) return;
  const list = Array.isArray(objectives) ? objectives : [];
  if (!list.length) {
    host.innerHTML = `<div class="mutedLine">No public objectives configured.</div>`;
    return;
  }

  host.innerHTML = list.map(o => {
    const progress = Number(o.progress || 0);
    const target = Math.max(1, Number(o.target || 1));
    const percent = Math.max(0, Math.min(100, Math.round((progress / target) * 100)));
    const reward = o.rewardPoints ? ` · Reward: ${esc(o.rewardPoints)} point${Number(o.rewardPoints) === 1 ? "" : "s"} each` : "";
    return `<div class="pendingItem publicObjectiveItem">
      <strong>${esc(o.title || o.id)}</strong>${o.completed ? " ✅" : ""}<br>
      <span>${esc(o.description || "")}</span><br>
      <span>Progress: ${esc(progress)}/${esc(target)} (${esc(percent)}%)${reward}</span>
    </div>`;
  }).join("");
}

function renderAudienceVotes(votes, threshold = null) {
  const host = document.getElementById("audienceVotes");
  if (!host) return;
  const open = (votes || []).filter(v => v.status === "open");
  if (!open.length) { host.innerHTML = `<div class="mutedLine">No open audience votes.</div>`; return; }
  host.innerHTML = open.map(v => {
    const count = v.audienceCount || v.count || 0;
    const voters = Array.isArray(v.audienceNames) && v.audienceNames.length ? ` · Voters: ${esc(v.audienceNames.join(", "))}` : "";
    const limit = threshold ? `/${esc(threshold)}` : "";
    return `<div class="hostAction">
    <div><strong>${esc(actionLabel(v.type))}${v.tokenType ? ` (${esc(v.tokenType)} token)` : ""}</strong><br><span>Target: ${esc(v.targetName || "Unknown")} · Votes: ${esc(count)}${limit}${voters}</span></div>
    <div class="hostActionButtons">
      <button class="hostButton approveVote" data-id="${esc(v.id)}">Approve</button>
      <button class="hostButton rejectVote" data-id="${esc(v.id)}">Reject</button>
    </div>
  </div>`;
  }).join("");
  document.querySelectorAll(".approveVote,.rejectVote").forEach(btn => btn.onclick = () => resolveVote(btn.dataset.id, btn.classList.contains("approveVote")));
}


function renderSessionStats(stats) {
  const host = document.getElementById("sessionStats");
  if (!host) return;
  if (!stats.length) { host.innerHTML = `<div class="mutedLine">No session stats yet.</div>`; return; }
  host.innerHTML = stats.map(p => `<div class="pendingItem"><strong>${esc(p.name)}</strong> · Shocked ${esc(p.stats?.shocked || 0)} · Selected ${esc(p.stats?.selected || 0)} · Points ${esc(p.points || 0)}</div>`).join("");
}

async function resolveVote(voteId, approved) {
  const res = await fetch(`/api/host/audience-vote?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voteId, approved })
  });
  const data = await res.json();
  if (!res.ok) return setStatus(data.error || "Could not resolve vote");
  setStatus(approved ? "Audience vote approved." : "Audience vote rejected.");
  await load();
}

async function acknowledgeObjectives(ids) {
  const res = await fetch(`/api/host/objective-events/ack?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids })
  });
  const data = await res.json();
  if (!res.ok) return setStatus(data.error || "Could not acknowledge objective");
  await load();
}

async function sendSpinnerCommand(command, extra = {}) {
  const res = await fetch(`/api/host/spinner?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, ...extra })
  });
  const data = await res.json();
  document.getElementById("spinnerStatus").textContent = res.ok ? `${command} requested.` : (data.error || "Command failed");
  return { res, data };
}

async function sendSpecificEvent() {
  try {
    const select = document.getElementById("forceEventCard");
    const eventCardId = select?.value || "";
    if (!eventCardId) throw new Error("Pick an event card first");
    const pickedTitle = select?.selectedOptions?.[0]?.textContent || eventCardId;
    const { res, data } = await sendSpinnerCommand("forceEventNextRound", { eventCardId });
    if (!res.ok) throw new Error(data.error || "Could not force selected event");
    document.getElementById("forceEventStatus").textContent = `${pickedTitle} queued for the next round.`;
    await load();
  } catch (err) {
    document.getElementById("forceEventStatus").textContent = err.message;
  }
}

async function resolveAction(actionId, approved) {
  const res = await fetch(`/api/host/action?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionId, approved })
  });
  const data = await res.json();
  if (!res.ok) return setStatus(data.error || "Could not resolve action");
  setStatus(approved ? "Action approved." : "Action rejected.");
  await load();
}

async function sendForcePlayer() {
  try {
    const targetPlayerId = document.getElementById("forcePlayer").value;
    const res = await fetch(`/api/host/force-player?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPlayerId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Force select failed");
    document.getElementById("forcePlayerStatus").textContent = "Player will be included next round.";
    await load();
  } catch (err) {
    document.getElementById("forcePlayerStatus").textContent = err.message;
  }
}

async function sendReward() {
  try {
    const targetPlayerId = document.getElementById("rewardPlayer").value;
    const rewardType = document.getElementById("rewardType").value;
    const tokenType = document.getElementById("rewardTokenType").value;
    const amount = Number(document.getElementById("rewardAmount").value || 1);
    const res = await fetch(`/api/host/reward?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPlayerId, rewardType, tokenType, amount })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Reward failed");
    document.getElementById("rewardStatus").textContent = rewardType === "token" ? `Gave ${amount} ${tokenType} token(s).` : `Gave ${amount} point(s).`;
    await load();
  } catch (err) {
    document.getElementById("rewardStatus").textContent = err.message;
  }
}

async function sendManual() {
  try {
    const id = document.getElementById("manualPlayer").value;
    const type = document.getElementById("manualType").value;
    const intensity = Number(document.getElementById("manualIntensity").value || 0);
    const duration = Number(document.getElementById("manualDuration").value || 500);
    const res = await fetch(`/api/host/control?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, selectedValue: type === "Shock" ? intensity : 0, duration, exclusive: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Manual control failed");
    document.getElementById("manualStatus").textContent = `${type} sent.`;
  } catch (err) {
    document.getElementById("manualStatus").textContent = err.message;
  }
}

function scheduleNextLoad(interval) {
  clearTimeout(timer);
  timer = setTimeout(load, interval);
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    const res = await fetch(`/api/host/state?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load host state");
    latest = data;
    document.getElementById("roundLine").textContent = `Round ${data.roundNumber ?? 0}`;
    const pauseBtn = document.getElementById("hostPauseToggleBtn");
    if (pauseBtn) {
      pauseBtn.textContent = data.hostPaused ? "Resume" : "Pause";
      pauseBtn.dataset.command = data.hostPaused ? "resume" : "pause";
    }
    renderPlayers(data.players || []);
    renderRewardOptions(data.economy || {});
    renderEventCardOptions(data.eventCards || []);
    renderModifiers(data.pendingRoundModifiers || []);
    renderAudienceVotes(data.audienceVotes || [], data.audienceVoteThresholdEffective || data.economy?.audienceVoteThreshold || null);
    renderObjectiveEvents(data.completedObjectiveEvents || []);
    renderPublicObjectives(data.publicObjectives || []);
    renderActions(data.pendingPlayerActions || []);
    renderSessionStats(data.sessionStats || []);
    setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    const interval = Math.max(500, Number(data.hostPage?.autoRefreshMs || 1500));
    scheduleNextLoad(interval);
  } catch (err) {
    setStatus(err.message);
    scheduleNextLoad(3000);
  } finally {
    loading = false;
  }
}

document.getElementById("rewardSendBtn")?.addEventListener("click", sendReward);
document.getElementById("forcePlayerBtn")?.addEventListener("click", sendForcePlayer);
document.getElementById("hostForceSpecificEventBtn")?.addEventListener("click", sendSpecificEvent);
load();


document.getElementById("hostSpinBtn")?.addEventListener("click", () => sendSpinnerCommand("spin"));
document.getElementById("hostPauseToggleBtn")?.addEventListener("click", (event) => sendSpinnerCommand(event.currentTarget.dataset.command || "pause"));
document.getElementById("hostForceEventBtn")?.addEventListener("click", () => sendSpinnerCommand("forceEventNextRound"));
