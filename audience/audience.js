let timer = null;
let loading = false;
let audienceSessionId = localStorage.getItem("osrAudienceSessionId") || "";
let audienceDisplayName = localStorage.getItem("osrAudienceDisplayName") || "";

function clearAudienceLogin() {
  audienceSessionId = "";
  audienceDisplayName = "";
  localStorage.removeItem("osrAudienceSessionId");
  localStorage.removeItem("osrAudienceDisplayName");
}

function setStatus(text) { document.getElementById("statusLine").textContent = text; }
function setActionStatus(text) { document.getElementById("actionStatus").textContent = text; }
function setLoginStatus(text) { document.getElementById("loginStatus").textContent = text; }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function cleanName(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 40); }

function showLogin() {
  document.getElementById("loginCard").hidden = false;
  document.getElementById("mainCard").hidden = true;
  document.getElementById("voteCard").hidden = true;
  document.getElementById("audienceNameInput").value = audienceDisplayName || "";
}

function showAudience() {
  document.getElementById("loginCard").hidden = true;
  document.getElementById("mainCard").hidden = false;
  document.getElementById("voteCard").hidden = false;
}

function actionLabel(type) {
  return String(type || "action")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function ensureAudienceSession(forceName = false) {
  const displayName = cleanName(forceName ? document.getElementById("audienceNameInput").value : audienceDisplayName);
  if (!displayName) throw new Error("Enter an audience name first.");

  const body = { displayName };
  if (audienceSessionId) body.audienceSessionId = audienceSessionId;

  const res = await fetch(`/api/audience/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not create audience session");

  audienceSessionId = data.session.id;
  audienceDisplayName = data.session.displayName || displayName;
  localStorage.setItem("osrAudienceSessionId", audienceSessionId);
  localStorage.setItem("osrAudienceDisplayName", audienceDisplayName);
  document.getElementById("audienceSessionLine").textContent = `${audienceDisplayName} · ${audienceSessionId}`;
  showAudience();
  return data.session;
}

function renderPlayers(players) {
  const select = document.getElementById("targetPlayerSelect");
  const current = select.value;
  select.innerHTML = "";
  players.forEach(p => {
    const opt = document.createElement("option"); opt.value = p.id; opt.textContent = p.name; select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function renderVotes(data) {
  const box = document.getElementById("votesBox");
  if (!box) return;
  const votes = (data.audienceVotes || []).filter(v => v.status === "open");
  const threshold = data.audienceVoteThresholdEffective || data.economy?.audienceVoteThreshold || 1;
  if (!votes.length) { box.innerHTML = `<div class="mutedLine">No open votes yet. Effective approval threshold: ${esc(threshold)}.</div>`; return; }
  const nameFor = id => (data.players || []).find(p => String(p.id) === String(id))?.name || "Unknown";
  box.innerHTML = votes.map(v => {
    const voters = Array.isArray(v.audienceNames) && v.audienceNames.length ? ` · voters: ${esc(v.audienceNames.join(", "))}` : "";
    const count = v.audienceCount || v.count || 0;
    return `<div class="pendingItem"><strong>${esc(actionLabel(v.type))}${v.tokenType ? ` (${esc(v.tokenType)})` : ""}</strong> → ${esc(nameFor(v.targetPlayerId))} · ${esc(count)}/${esc(threshold)} vote(s)${voters}</div>`;
  }).join("");
}

function renderTokens(economy) {
  const select = document.getElementById("tokenTypeSelect");
  const current = select.value;
  select.innerHTML = "";
  (economy.tokenTypes || ["shield", "mercy", "blessing", "curse", "chaos", "guarantee"]).forEach(type => {
    const opt = document.createElement("option"); opt.value = type; opt.textContent = type; select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function renderAudienceSession(session, economy) {
  if (!session) return;
  audienceDisplayName = session.displayName || audienceDisplayName || "Audience";
  localStorage.setItem("osrAudienceDisplayName", audienceDisplayName);
  document.getElementById("audienceSessionLine").textContent = `${audienceDisplayName} · votes: ${session.totalVotes || 0}`;
  const max = economy?.audienceMaxVotesPerRound || 1;
  const cooldown = economy?.audienceCooldownSeconds || 0;
  const roundVotes = session.votesThisRound || 0;
  document.getElementById("cooldownLine").textContent = `Limit: ${roundVotes}/${max} vote(s) this round · Cooldown: ${cooldown}s`;
}

async function send(type) {
  try {
    if (!audienceSessionId || !audienceDisplayName) await ensureAudienceSession(false);
    const targetPlayerId = document.getElementById("targetPlayerSelect").value;
    const tokenType = document.getElementById("tokenTypeSelect").value;
    const res = await fetch(`/api/audience/action`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ type, targetPlayerId, tokenType, audienceSessionId, displayName: audienceDisplayName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not queue audience action");
    setActionStatus("Vote added. The host must approve it before it becomes active.");
    await load();
  } catch (err) { setActionStatus(err.message); }
}

function scheduleNextLoad(interval) {
  clearTimeout(timer);
  timer = setTimeout(load, interval);
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    if (!audienceSessionId || !audienceDisplayName) { showLogin(); return; }
    const res = await fetch(`/api/audience/state?audienceSessionId=${encodeURIComponent(audienceSessionId)}&displayName=${encodeURIComponent(audienceDisplayName)}`, { cache:"no-store" });
    const data = await res.json();
    if (res.status === 401 || res.status === 404) {
      clearAudienceLogin();
      showLogin();
      setLoginStatus(data.error || "Audience session expired. Enter your name again.");
      return;
    }
    if (!res.ok) throw new Error(data.error || "Could not load audience page");
    document.getElementById("roundLine").textContent = `Round ${data.roundNumber ?? 0}`;
    renderPlayers(data.players || []);
    renderTokens(data.economy || {});
    if (data.audienceSession?.id && data.audienceSession.id !== audienceSessionId) {
      audienceSessionId = data.audienceSession.id;
      localStorage.setItem("osrAudienceSessionId", audienceSessionId);
    }
    renderAudienceSession(data.audienceSession, data.economy || {});
    renderVotes(data);
    showAudience();
    setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    const interval = Math.max(500, Number(data.audiencePage?.autoRefreshMs || 2500));
    scheduleNextLoad(interval);
  } catch (err) {
    setStatus(err.message);
    scheduleNextLoad(3000);
  } finally {
    loading = false;
  }
}

document.getElementById("joinBtn").onclick = async () => {
  try {
    setLoginStatus("Joining...");
    await ensureAudienceSession(true);
    setLoginStatus("");
    await load();
  } catch (err) { setLoginStatus(err.message); }
};
document.getElementById("changeNameBtn").onclick = () => {
  if (timer) { clearInterval(timer); timer = null; }
  clearAudienceLogin();
  showLogin();
};
document.getElementById("audienceNameInput").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("joinBtn").click();
});
document.getElementById("blessBtn").onclick = () => send("blessPlayer");
document.getElementById("curseBtn").onclick = () => send("cursePlayer");
document.getElementById("tokenBtn").onclick = () => send("giveToken");
document.getElementById("guaranteeBtn").onclick = () => send("guaranteedPick");
load();
