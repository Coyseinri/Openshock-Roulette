"use strict";
let state = null;
let templates = [];
let importValidationId = null;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function statusText(ok, text, disabled = false) {
  return `<span class="${disabled ? "status-disabled" : ok ? "status-ok" : "status-bad"}">● ${esc(text)}</span>`;
}

function setMessage(text, isError = false) {
  const el = $("message");
  el.textContent = text || "";
  el.classList.toggle("error", Boolean(isError));
}

async function setupAction(action) {
  const res = await fetch("/api/setup/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Setup action failed");
  state = data;
  render();
  return data;
}

async function postJson(url, body = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.result?.error || data.result?.reason || "Request failed");
  if (data.state) { state = data.state; render(); }
  return data;
}

async function load(refreshShock = false) {
  const [stateRes, templateRes] = await Promise.all([
    fetch(`/api/setup/state${refreshShock ? "?refresh=1" : ""}`, { cache: "no-store" }),
    fetch("/api/intiface/templates", { cache: "no-store" })
  ]);
  const data = await stateRes.json();
  if (!stateRes.ok) throw new Error(data.error || "Could not load setup");
  state = data;
  if (templateRes.ok) {
    const templateData = await templateRes.json();
    templates = Array.isArray(templateData.templates) ? templateData.templates : templates;
  }
  render();
}

function templateOptions(selected) {
  const list = templates.length ? templates : [{ id: "soft-wave", name: "Soft wave" }];
  return list.map(t => `<option value="${esc(t.id)}"${String(t.id) === String(selected) ? " selected" : ""}>${esc(t.name || t.id)}</option>`).join("");
}

function deviceStatus(device) {
  if (device.connection) return `<span class="${device.connection.status === 'online' ? 'status-ok' : 'status-bad'}">● ${esc(device.connection.status)} · ${esc(device.connection.reason)}</span>`;
  if (device.ambiguous) return `<span class="status-bad">● ambiguous identity — give each Toy a unique Intiface display name and review assignments</span>`;
  if (device.enabled === false) return `<span class="status-disabled">● disabled</span>`;
  if (device.online === false) return `<span class="status-bad">● offline</span>`;
  return `<span class="status-ok">● online</span>`;
}

function deviceCard(player, device) {
  const isToy = device.provider === "intiface";
  const mappingWarning = isToy && !device.mappingReady
    ? `<div class="mapping-warning">No active mapped Toy output. <a href="/setup#toys">Open Advanced Setup</a>.</div>` : "";
  const testControls = isToy
    ? `<div class="test-controls"><span class="device-meta">Test power: 25% × multiplier</span><button data-action="test-toy" data-provider="intiface" data-device="${esc(device.id)}">Test Toy</button><button class="danger" data-action="stop-device" data-provider="intiface" data-device="${esc(device.id)}">Stop</button></div>`
    : `<div class="test-controls"><button data-action="test-vibe" data-provider="openshock" data-device="${esc(device.id)}">Vibe Test</button><label>Shock test <input class="shock-test-value" type="number" min="1" max="99" value="10" data-shock-test-value="${esc(device.id)}"></label><button class="warn" data-action="test-shock" data-provider="openshock" data-device="${esc(device.id)}">TEST SHOCK</button></div>`;
  return `<div class="device-row device-card" data-device-row="${esc(device.provider)}:${esc(device.id)}">
    <div class="device-main"><strong>${isToy ? "Toy" : "Shock"} · ${esc(device.memberName || device.name)}</strong><div class="device-meta">${deviceStatus(device)} · multiplier ${esc(device.intensityMultiplier ?? 100)}%${isToy ? ` · ${esc(device.preferredTemplate || "soft-wave")}` : ""}</div>${mappingWarning}</div>
    <div class="device-actions"><label><input type="checkbox" data-device-enabled data-provider="${esc(device.provider)}" data-device="${esc(device.id)}"${device.enabled !== false ? " checked" : ""}> Enabled</label><label>Multiplier <input class="device-percent" type="number" min="0" max="100" step="1" value="${esc(device.intensityMultiplier ?? 100)}" data-device-multiplier data-provider="${esc(device.provider)}" data-device="${esc(device.id)}">%</label>${isToy ? `<label>Template <select data-device-template data-provider="intiface" data-device="${esc(device.id)}">${templateOptions(device.preferredTemplate || "soft-wave")}</select></label>` : ""}<button data-action="unassign" data-provider="${esc(device.provider)}" data-device="${esc(device.id)}">Unassign</button>${testControls}</div>
  </div>`;
}

function playerCard(player) {
  const devices = (player.devices || []).map(device => deviceCard(player, device)).join("") || `<p class="device-meta">No devices assigned.</p>`;
  return `<div class="player-card"><div class="player-card-head"><div><strong>${esc(player.name)}</strong><div class="device-meta">${esc(player.id)}</div></div><div><button data-action="rename" data-player="${esc(player.id)}">Rename</button> <button data-action="toggle" data-player="${esc(player.id)}" data-enabled="${player.enabled !== false}">${player.enabled === false ? "Enable" : "Disable"}</button> <button data-action="remove" data-player="${esc(player.id)}">Remove</button></div></div>${devices}</div>`;
}

function pool(items, provider) {
  const unassigned = (items || []).filter(device => !device.assigned);
  if (!unassigned.length) return `<p class="device-meta">None.</p>`;
  const options = (state.players || []).map(player => `<option value="${esc(player.id)}">${esc(player.name)}</option>`).join("");
  return unassigned.map(device => `<div class="device-row"><div><strong>${esc(device.name)}</strong><div class="device-meta">${device.ambiguous ? esc(device.identityWarning) : device.online === false ? "offline" : "online"}${provider === "intiface" && !device.mappingReady ? " · mapping incomplete" : ""}</div></div><select ${device.ambiguous ? 'disabled' : ''} data-assign-player="${esc(provider)}:${esc(device.id)}"><option value="">Assign to…</option>${options}</select></div>`).join("");
}

function render() {
  if (!state) return;
  const shock = state.providers?.shock || {};
  const toy = state.providers?.toy || {};
  $("shockStatus").innerHTML = statusText(Boolean(shock.reachable), shock.reachable ? "reachable" : "last request failed");
  $("toyStatus").innerHTML = statusText(Boolean(toy.connected), toy.enabled === false ? "disabled" : toy.connected ? "connected" : "disconnected", toy.enabled === false);
  $("shockCount").textContent = `${(state.devices?.shock || []).length} device(s) found`;
  $("toyCount").textContent = `${toy.deviceCount ?? (state.devices?.toy || []).filter(d => d.online).length} connected device(s)`;
  const active = (state.readiness || []).filter(item => item.enabled);
  const ready = active.filter(item => item.ready);
  const notReady = active.filter(item => !item.ready);
  $("readiness").innerHTML = `<div>Ready ${ready.length}/${active.length} active players</div><a href="#hardware">Hardware check: ${esc(state.hardwareCheck?.status || 'checking')}</a>${state.hardwareCheck?.blockers?.length ? `<div class="mapping-warning">Resolve blocked mappings before starting.</div>` : notReady.length ? `<div class="mapping-warning">No online output: ${notReady.map(item => esc(item.name)).join(", ")}. You may still start.</div>` : ""}`;
  if (typeof renderHardwareCheck === 'function') renderHardwareCheck(state.hardwareCheck);
  // Polling must not replace an open selector or an unfinished edit.
  if (document.querySelector('[data-setup-panel="players"]')?.contains(document.activeElement)) return;
  $("players").innerHTML = (state.players || []).map(playerCard).join("") || `<p>No players yet.</p>`;
  $("shockDevices").innerHTML = pool(state.devices?.shock, "openshock");
  $("toyDevices").innerHTML = pool(state.devices?.toy, "intiface");
  $("suggestions").innerHTML = (state.suggestions || []).map(s => `<div class="device-row"><span>${esc(s.deviceName)} → <strong>${esc(s.playerName)}</strong></span><button data-action="accept-suggestion" data-provider="${esc(s.provider)}" data-device="${esc(s.deviceId)}" data-name="${esc(s.deviceName)}" data-player="${esc(s.playerId)}">Accept</button></div>`).join("") || `<p class="device-meta">No suggestions.</p>`;
  bindDynamic();
}

function updateDevice(provider, deviceId, patch) { return setupAction({ action: "updateDevice", provider, deviceId, ...patch }); }

async function runDeviceTest(button, action) {
  const provider = button.dataset.provider;
  const deviceId = button.dataset.device;
  const payload = { provider, deviceId, durationMs: 1500 };
  if (action === "test-toy") Object.assign(payload, { testType: "toy", testPower: 25 });
  if (action === "test-vibe") Object.assign(payload, { testType: "vibe", testPower: 25 });
  if (action === "test-shock") {
    const input = document.querySelector(`[data-shock-test-value="${CSS.escape(deviceId)}"]`);
    Object.assign(payload, { testType: "shock", testValue: Math.max(1, Math.min(99, Number(input?.value || 10))) });
    if (!window.confirm(`Send a real Shock test at ${payload.testValue} before the device multiplier?`)) return;
  }
  setMessage("Sending test…");
  const data = await postJson("/api/setup/test-device", payload);
  const r = data.result || {};
  setMessage(r.skipped ? `Test skipped: ${r.reason}` : `Test sent${r.intensity ? ` at ${r.intensity}` : ""}.`);
}

function bindDynamic() {
  document.querySelectorAll("[data-assign-player]").forEach(select => select.onchange = () => {
    if (!select.value) return;
    const [provider, ...rest] = select.dataset.assignPlayer.split(":");
    setupAction({ action: "assignDevice", provider, deviceId: rest.join(":"), playerId: select.value, deviceName: select.closest(".device-row").querySelector("strong").textContent }).catch(showError);
  });
  document.querySelectorAll("[data-device-enabled]").forEach(el => el.onchange = () => updateDevice(el.dataset.provider, el.dataset.device, { enabled: el.checked }).catch(showError));
  document.querySelectorAll("[data-device-multiplier]").forEach(el => el.onchange = () => updateDevice(el.dataset.provider, el.dataset.device, { intensityMultiplier: Math.max(0, Math.min(100, Number(el.value) || 0)) }).catch(showError));
  document.querySelectorAll("[data-device-template]").forEach(el => el.onchange = () => updateDevice(el.dataset.provider, el.dataset.device, { preferredTemplate: el.value }).catch(showError));
  document.querySelectorAll("[data-action]").forEach(button => button.onclick = async () => {
    try {
      const action = button.dataset.action;
      if (["test-toy", "test-vibe", "test-shock"].includes(action)) return await runDeviceTest(button, action);
      if (action === "stop-device") { await postJson("/api/setup/stop-device", { provider: button.dataset.provider, deviceId: button.dataset.device }); setMessage("Device stop sent."); return; }
      if (action === "unassign") await setupAction({ action: "unassignDevice", provider: button.dataset.provider, deviceId: button.dataset.device });
      if (action === "remove" && window.confirm("Remove this player? Devices will become unassigned.")) await setupAction({ action: "removePlayer", playerId: button.dataset.player });
      if (action === "toggle") await setupAction({ action: "setPlayerEnabled", playerId: button.dataset.player, enabled: button.dataset.enabled !== "true" });
      if (action === "rename") { const name = window.prompt("Player name"); if (name) await setupAction({ action: "renamePlayer", playerId: button.dataset.player, name }); }
      if (action === "accept-suggestion") await setupAction({ action: "assignDevice", provider: button.dataset.provider, deviceId: button.dataset.device, deviceName: button.dataset.name, playerId: button.dataset.player });
    } catch (err) { showError(err); }
  });
}

function showError(err) { setMessage(err.message || String(err), true); }
$("createPlayerBtn").onclick = () => { const name = $("newPlayerName").value.trim(); if (!name) return; setupAction({ action: "createPlayer", name }).then(() => { $("newPlayerName").value = ""; }).catch(showError); };
$("startGameBtn").onclick = () => setupAction({ action: "completeSetup" }).then(() => { window.location.href = "/"; }).catch(showError);
$("refreshShockBtn").onclick = () => { setMessage("Refreshing OpenShock devices…"); load(true).then(() => setMessage("Shock devices refreshed.")).catch(showError); };
$("scanToyBtn").onclick = () => { setMessage("Scanning Intiface devices…"); postJson("/api/setup/scan-intiface").then(data => { state = data; render(); setMessage("Toy scan complete."); }).catch(showError); };
$("exportConfigBtn").onclick = () => {
  const scopes = [...document.querySelectorAll("[data-export-scope]:checked")].map(input => input.value);
  if (!scopes.length) return setMessage("Select at least one export scope.", true);
  window.location.href = `/api/setup/config-export?scopes=${encodeURIComponent(scopes.join(","))}`;
};
$("previewImportBtn").onclick = async () => {
  try {
    const file = $("importConfigFile").files[0];
    if (!file) throw new Error("Choose a JSON export first.");
    if (file.size > 1024 * 1024) throw new Error("Import file exceeds 1 MiB.");
    const result = await postJson("/api/setup/config-import/preview", { document: JSON.parse(await file.text()), mode: $("importMode").value });
    importValidationId = result.validationId; $("applyImportBtn").disabled = false; $("importPreview").hidden = false;
    $("importPreview").textContent = JSON.stringify({ mode: result.mode, scopes: result.scopes, changes: result.diff, warnings: result.warnings }, null, 2);
    $("importWarning").textContent = (result.warnings || []).join(" ");
    setMessage("Import is valid. Review the preview before applying.");
  } catch (err) { importValidationId = null; $("applyImportBtn").disabled = true; showError(err); }
};
$("applyImportBtn").onclick = async () => {
  try {
    if (!importValidationId) throw new Error("Validate the import first.");
    if (!window.confirm("Apply this validated import? A local backup will be created first.")) return;
    const result = await postJson("/api/setup/config-import/apply", { validationId: importValidationId });
    importValidationId = null; $("applyImportBtn").disabled = true; await load();
    setMessage(`Import applied. Backup: ${result.backup}`);
  } catch (err) { showError(err); }
};
load().catch(showError);
