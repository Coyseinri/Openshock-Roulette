// Host dashboard action extensions.
// Loaded after host.js so the existing page can stay simple.

const baseHostLoad = load;

function hostActionLabel(type) {
  return actionLabel(type);
}

function syncManualSafety(safety = {}) {
  const input = document.getElementById("manualIntensity");
  if (!input) return;
  const maxShock = Math.max(1, Math.min(100, Number(safety.serverMaxShockIntensity ?? 99)));
  input.max = String(maxShock);
  if (Number(input.value || 0) > maxShock) input.value = String(maxShock);
  input.title = `Shock values are clamped to ${maxShock} before player multiplier is applied.`;
}

renderModifiers = function renderModifiersWithCancel(modifiers) {
  const host = document.getElementById("pendingModifiers");
  if (!host) return;
  if (!modifiers.length) {
    host.innerHTML = `<div class="mutedLine">No pending next-round effects.</div>`;
    return;
  }
  host.innerHTML = modifiers.map(m => `<div class="hostAction">
    <div><strong>${esc(hostActionLabel(m.type))}</strong><br><span>${esc(m.targetName || m.playerName || m.eventTitle || m.eventCardId || "")}${m.bodyguardName ? ` · Bodyguard: ${esc(m.bodyguardName)}` : ""}</span></div>
    <div class="hostActionButtons"><button class="hostButton reject cancelModifier" data-id="${esc(m.id)}">Cancel</button></div>
  </div>`).join("");
  document.querySelectorAll(".cancelModifier").forEach(btn => btn.onclick = () => cancelModifier(btn.dataset.id));
};

async function cancelModifier(modifierId) {
  if (!modifierId) return;
  const res = await fetch(`/api/host/action?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionType: "cancelRoundModifier", modifierId })
  });
  const data = await res.json();
  if (!res.ok) return setStatus(data.error || "Could not cancel next-round effect");
  setStatus("Pending next-round effect cancelled.");
  await load();
}

sendManual = async function sendManualWithMultiplier() {
  try {
    const id = document.getElementById("manualPlayer").value;
    const type = document.getElementById("manualType").value;
    const intensity = Number(document.getElementById("manualIntensity").value || 0);
    const duration = Number(document.getElementById("manualDuration").value || 500);
    const res = await fetch(`/api/host/control?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, selectedValue: type === "Shock" ? intensity : 0, duration, exclusive: true, applyPlayerMultiplier: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Manual control failed");
    const sent = data.sent || {};
    document.getElementById("manualStatus").textContent = sent.type === "Shock"
      ? `Shock sent: selected ${sent.selectedValue}, applied ${sent.intensity}${sent.multiplierPercent !== null && sent.multiplierPercent !== undefined ? ` (${sent.multiplierPercent}% multiplier)` : ""}.`
      : `${type} sent.`;
  } catch (err) {
    document.getElementById("manualStatus").textContent = err.message;
  }
};

load = async function loadWithManualSafety() {
  await baseHostLoad();
  syncManualSafety(latest?.safety || {});
};

document.getElementById("manualSendBtn").onclick = sendManual;
load();
