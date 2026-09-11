"use strict";
const hardwareResults = new Map();
let hardwareBusy = false;
let hardwareSignature = '';
let hardwareRenderedDevices = [];
function hardwareKey(device) {
  return JSON.stringify([device.playerId, device.provider, device.id, device.generation, device.multiplier, device.durationMs]);
}
function renderHardwareCheck(check) {
  if (!check) return;
  $('hardwareSummary').innerHTML = `<p><strong>${esc(check.status.toUpperCase())}</strong> · ${esc(check.note)}</p>${[...check.blockers, ...check.warnings].map(text => `<p class="mapping-warning">${esc(text)}</p>`).join('')}`;
  const signature = JSON.stringify(check.devices);
  if (signature === hardwareSignature || hardwareBusy || $('hardwareDevices').contains(document.activeElement)) return;
  hardwareSignature = signature;
  hardwareRenderedDevices = check.devices;
  $('hardwareDevices').innerHTML = check.devices.map((device, index) => {
    const result = hardwareResults.get(hardwareKey(device));
    return `<div class="hardware-row" data-hardware-index="${index}"><strong>${esc(device.playerName)} · ${esc(device.name)}</strong><p>${esc(device.provider === 'intiface' ? 'Toy' : 'OpenShock')} · ${esc(device.status)} · ${esc(device.reason)}</p><p class="device-meta">Power multiplier ${esc(device.multiplier)}% · gameplay duration ${esc(device.durationMs)} ms · test: 25% × multiplier, ${device.provider === 'intiface' ? 'up to ' : ''}1500 ms within configured limits</p><div class="setup-actions"><button data-hardware-test ${device.canTest ? '' : 'disabled'}>${device.provider === 'intiface' ? 'Test Toy' : 'Vibration test'}</button><button data-hardware-stop class="danger" ${device.canStop ? '' : 'disabled'}>Stop</button><label><input type="checkbox" data-hardware-confirm ${result?.sent ? '' : 'disabled'} ${result?.confirmed ? 'checked' : ''}> I saw the correct device respond</label></div><div class="hardware-result" role="status">${esc(result?.message || 'Not physically checked in this browser session.')}</div></div>`;
  }).join('') || '<p>No devices assigned. Add them under Players.</p>';
}

$('hardwareDevices').addEventListener('change', event => {
  if (!event.target.matches('[data-hardware-confirm]')) return;
  const device = hardwareRenderedDevices[Number(event.target.closest('[data-hardware-index]').dataset.hardwareIndex)];
  const result = hardwareResults.get(hardwareKey(device));
  if (result) result.confirmed = event.target.checked;
});
$('hardwareDevices').addEventListener('click', async event => {
  const button = event.target.closest('[data-hardware-test], [data-hardware-stop]');
  if (!button || hardwareBusy) return;
  const device = hardwareRenderedDevices[Number(button.closest('[data-hardware-index]').dataset.hardwareIndex)];
  const stop = button.hasAttribute('data-hardware-stop');
  hardwareBusy = true; button.disabled = true;
  try {
    const data = await postJson(`/api/setup/${stop ? 'stop' : 'test'}-device`, { provider: device.provider, deviceId: device.id, expectedGeneration: device.generation, testType: device.provider === 'intiface' ? 'toy' : 'vibe', testPower: 25, durationMs: 1500 });
    const result = data.result || {};
    if (result.skipped || result.ok === false) throw new Error(result.reason || 'Device did not accept the request');
    if (!stop) hardwareResults.set(hardwareKey(device), { sent: true, confirmed: false, message: 'Test accepted. Confirm the correct physical response yourself.' });
    setMessage(stop ? 'Stop sent.' : 'Test accepted; check the device response.');
  } catch (err) {
    if (!stop) hardwareResults.set(hardwareKey(device), { sent: false, confirmed: false, message: err.message });
    showError(err);
  } finally {
    hardwareBusy = false; button.blur(); hardwareSignature = ''; renderHardwareCheck(state.hardwareCheck);
  }
});
$('refreshHardwareBtn').onclick = () => load(true).catch(showError);
$('hardwareStopAllBtn').onclick = () => postJson('/api/stop-all').then(() => { hardwareResults.clear(); hardwareSignature = ''; return load(); }).then(() => setMessage('Stop All sent. Pending output has been cancelled.')).catch(showError);

function selectSetupTab() {
  const requested = location.hash.slice(1);
  const tab = ['players', 'hardware', 'toys', 'transfer'].includes(requested) ? requested : 'players';
  document.querySelectorAll('[data-setup-panel]').forEach(panel => { panel.hidden = panel.dataset.setupPanel !== tab; });
  document.querySelectorAll('.setup-tabs a').forEach(link => { if (link.hash === `#${tab}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (tab === 'toys' && !$('toySetupFrame').hasAttribute('src')) $('toySetupFrame').src = '/setup/toys';
  if (tab !== 'toys' && state) load().catch(showError);
}
window.addEventListener('hashchange', selectSetupTab);
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== $('toySetupFrame').contentWindow || event.data?.type !== 'osr-toy-height') return;
  $('toySetupFrame').style.height = `${Math.max(600, Math.min(50000, Number(event.data.height) || 1000))}px`;
});
selectSetupTab();
let hardwarePolling = false;
setInterval(async () => {
  if (document.hidden || hardwareBusy || hardwarePolling || location.hash === '#toys') return;
  hardwarePolling = true;
  try { await load(); } catch (err) { showError(err); } finally { hardwarePolling = false; }
}, 5000);
