const pathParts = window.location.pathname.split("/").filter(Boolean);
const playerId = decodeURIComponent(pathParts[1] || "");
const key = new URLSearchParams(window.location.search).get("key") || "";
let refreshTimer = null;
let loading = false;
let latestData = null;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
}

function setStatus(text) {
  document.getElementById("statusLine").textContent = text;
}

function setActionStatus(text) {
  document.getElementById("actionStatus").textContent = text;
}

function statRow(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function playerName(data, id, fallback = "Unknown player") {
  if (!id) return "";
  if (String(data.player?.id) === String(id)) return data.player?.name || fallback;
  const match = (data.players || []).find(p => String(p.id) === String(id));
  return match?.name || fallback;
}

function actionLabel(type) {
  return String(type || "action")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function renderPlayers(data) {
  const select = document.getElementById("targetPlayerSelect");
  const current = select.value;
  select.innerHTML = "";
  (data.players || []).filter(p => p.id !== data.player?.id).forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function renderPending(data) {
  const pending = data.pendingActions || [];
  const activeBodyguards = data.activeBodyguards || [];
  const box = document.getElementById("pendingBox");
  const rows = [];

  pending.forEach(a => {
    const targetName = a.targetName || playerName(data, a.targetPlayerId, "another player");
    const bodyguardName = a.bodyguardName || playerName(data, a.bodyguardPlayerId, "");
    const actorName = a.playerName || playerName(data, a.playerId, "Player");
    const direction = targetName ? ` → ${esc(targetName)}` : "";
    const helper = bodyguardName && bodyguardName !== actorName ? ` · Bodyguard: ${esc(bodyguardName)}` : "";
    rows.push(`<div class="pendingItem"><strong>${esc(actionLabel(a.type))}</strong>${a.tokenType ? ` (${esc(a.tokenType)} token)` : ""} · ${esc(a.status)} · ${esc(actorName)}${direction}${helper}</div>`);
  });

  activeBodyguards.forEach(m => {
    const targetName = m.targetName || playerName(data, m.targetPlayerId, "another player");
    const bodyguardName = m.bodyguardName || playerName(data, m.bodyguardPlayerId, "Bodyguard");
    const isBodyguard = String(m.bodyguardPlayerId) === String(data.player?.id);
    const text = isBodyguard
      ? `You are guarding ${esc(targetName)} this round.`
      : `${esc(bodyguardName)} is guarding you this round.`;
    rows.push(`<div class="pendingItem active"><strong>Active Bodyguard</strong> · ${text}</div>`);
  });

  if (!rows.length) {
    box.innerHTML = `<div class="mutedLine">No pending requests.</div>`;
    return;
  }
  box.innerHTML = rows.join("");
}

function tokenCount(data, tokenType) {
  return Number((data.tokens || {})[tokenType] || 0);
}

function renderTokenShop(data) {
  const economy = data.economy || {};
  const costs = economy.tokenCosts || {};
  const types = economy.tokenTypes || ["shield", "mercy", "blessing", "curse", "chaos", "guarantee"];
  const host = document.getElementById("tokenShop");
  host.innerHTML = types.map(type => `
    <button type="button" class="tokenBuyButton" data-token="${esc(type)}">
      Buy ${esc(type)} token <span>${esc(costs[type] ?? 0)} pts</span>
    </button>`).join("");
  document.querySelectorAll(".tokenBuyButton").forEach(btn => {
    btn.onclick = () => sendAction("buyToken", null, { tokenType: btn.dataset.token }, "shopStatus");
  });
}

function renderActions(data) {
  document.getElementById("shieldBtn").textContent = `Use Shield token (${tokenCount(data, "shield")})`;
  document.getElementById("mercyBtn").textContent = `Use Mercy token (${tokenCount(data, "mercy")})`;
  document.getElementById("chaosBtn").textContent = `Use Chaos token (${tokenCount(data, "chaos")})`;
  document.getElementById("immunityBtn").textContent = `Use Immunity token (${tokenCount(data, "immunity")})`;
  document.getElementById("blessBtn").textContent = `Use Blessing token (${tokenCount(data, "blessing")})`;
  document.getElementById("curseBtn").textContent = `Use Curse token (${tokenCount(data, "curse")})`;
  document.getElementById("guaranteeBtn").textContent = `Use Guarantee token (${tokenCount(data, "guarantee")})`;
  document.getElementById("doubleShockBtn").textContent = `Use Double Shock token (${tokenCount(data, "doubleShock")})`;
  renderPlayers(data);
  renderPending(data);
  renderTokenShop(data);
}

function render(data) {
  latestData = data;
  document.getElementById("playerName").textContent = data.player?.name || "Player";
  document.getElementById("roundLine").textContent = `Round ${data.roundNumber ?? 0}`;
  document.getElementById("pointsLine").textContent = `${data.points ?? 0} points`;
  const tokens = data.tokens || {};
  const tokenText = Object.entries(tokens).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${k} x${v}`).join(" · ");
  document.getElementById("tokensLine").textContent = tokenText || "No tokens yet";

  const role = data.hiddenRole;
  const roleBox = document.getElementById("roleBox");
  if (roleBox) {
    if (role) {
      const pct = role.target ? Math.min(100, Math.round((Number(role.progress || 0) / Number(role.target || 1)) * 100)) : 0;
      const rewardBits = [];
      if (Number(role.rewardPoints || 0) > 0) rewardBits.push(`+${esc(role.rewardPoints)} pts`);
      if (role.rewardToken && Number(role.rewardTokenAmount || 0) > 0) rewardBits.push(`${esc(role.rewardToken)} x${esc(role.rewardTokenAmount)}`);
      roleBox.innerHTML = `<article class="objective">
        <h3>${esc(role.title)}</h3>
        <p>${esc(role.description)}</p>
        ${role.passiveDescription ? `<div class="reward"><strong>Passive:</strong> ${esc(role.passiveDescription)}</div>` : ""}
        ${role.objectiveDescription ? `<p><strong>Role objective:</strong> ${esc(role.objectiveDescription)}</p>` : ""}
        ${role.target ? `<div class="progressBar"><div style="width:${pct}%"></div></div><div class="progressText">Role progress: ${esc(role.progress || 0)} / ${esc(role.target)}</div>` : `<div class="progressText">Passive role. No automatic bonus configured.</div>`}
        ${role.rewardDescription ? `<div class="reward"><strong>Reward:</strong> ${esc(role.rewardDescription)}</div>` : (rewardBits.length ? `<div class="reward">Hidden-role bonus: ${rewardBits.join(" · ")}${role.repeatable ? " · repeatable" : ""}</div>` : "")}
      </article>`;
    } else {
      roleBox.innerHTML = `<div class="emptyObjective">No hidden role assigned yet.</div>`;
    }
  }

  const objectives = data.objectives || [];
  const objectiveBox = document.getElementById("objectiveBox");
  if (!objectives.length) {
    objectiveBox.innerHTML = `<div class="emptyObjective">No secret objective assigned yet.</div>`;
  } else {
    objectiveBox.innerHTML = objectives.map(o => {
      const pct = o.target ? Math.min(100, Math.round((Number(o.progress || 0) / Number(o.target || 1)) * 100)) : 0;
      return `<article class="objective ${o.completed ? "complete" : ""}">
        <h3>${esc(o.title)} ${o.completed ? "✅" : ""}</h3>
        <p>${esc(o.description)}</p>
        <div class="progressBar"><div style="width:${pct}%"></div></div>
        <div class="progressText">${esc(o.progress ?? 0)} / ${esc(o.target ?? "?")}</div>
        <div class="reward">Reward: ${esc(o.reward)} ${o.rewardPoints ? `(+${esc(o.rewardPoints)} pts)` : ""}</div>
      </article>`;
    }).join("");
  }

  const s = data.stats || {};
  document.getElementById("statsGrid").innerHTML = [
    statRow("Selected", s.selected || 0),
    statRow("Shocked", s.shocked || 0),
    statRow("Vibes", s.vibes || 0),
    statRow("SAFE rounds", s.safe || 0),
    statRow("ALL targeted", s.allTargeted || 0),
    statRow("Total intensity", s.totalIntensity || 0),
    statRow("Tokens bought", s.tokensBought || 0),
    statRow("Last selected", s.lastSelectedRound || "-"),
    statRow("Last shocked", s.lastShockedRound || "-")
  ].join("");

  renderActions(data);
  setStatus(`Updated ${new Date().toLocaleTimeString()}`);
}

async function sendAction(type, targetPlayerId = null, extra = {}, statusId = "actionStatus") {
  try {
    if (!playerId || !key) throw new Error("Missing player id or access key.");
    const res = await fetch(`/api/player/${encodeURIComponent(playerId)}/action?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, targetPlayerId, ...extra })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not queue action");
    document.getElementById(statusId).textContent = type === "buyToken" ? "Token purchased." : "Action queued.";
    await load();
  } catch (err) {
    document.getElementById(statusId).textContent = err.message;
  }
}

function scheduleNextLoad(interval) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(load, interval);
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    if (!playerId || !key) throw new Error("Missing player id or access key.");
    const res = await fetch(`/api/player/${encodeURIComponent(playerId)}/state?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load player state");
    render(data);
    const interval = Math.max(500, Number(data.playerPages?.autoRefreshMs || 2000));
    scheduleNextLoad(interval);
  } catch (err) {
    setStatus(err.message);
    document.getElementById("objectiveBox").innerHTML = `<div class="errorBox">${esc(err.message)}</div>`;
    scheduleNextLoad(3000);
  } finally {
    loading = false;
  }
}

document.getElementById("shieldBtn").onclick = () => sendAction("useShieldToken");
document.getElementById("mercyBtn").onclick = () => sendAction("useMercyToken");
document.getElementById("chaosBtn").onclick = () => sendAction("useChaosToken");
document.getElementById("immunityBtn").onclick = () => sendAction("useImmunityToken");
document.getElementById("bodyguardBtn").onclick = () => sendAction("bodyguardOffer", document.getElementById("targetPlayerSelect").value);
document.getElementById("blessBtn").onclick = () => sendAction("blessPlayer", document.getElementById("targetPlayerSelect").value, { payment: "token" });
document.getElementById("curseBtn").onclick = () => sendAction("cursePlayer", document.getElementById("targetPlayerSelect").value, { payment: "token" });
document.getElementById("guaranteeBtn").onclick = () => sendAction("guaranteedPick", document.getElementById("targetPlayerSelect").value);
document.getElementById("doubleShockBtn").onclick = () => sendAction("useDoubleShockToken", document.getElementById("targetPlayerSelect").value);

load();
