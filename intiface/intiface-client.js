(() => {
  "use strict";

  const PAGE_MODE = document.body?.dataset?.intifacePage || "diagnostics";
  const IS_SETUP = PAGE_MODE === "setup";
  const DEFAULTS = {
    enabled: false,
    websocketUrl: "ws://127.0.0.1:12345",
    defaultPreviewDurationMs: 5000,
    maxPreviewDurationMs: 15000,
    commandTimeoutMs: 2500,
    commandGapMs: 120,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 1500,
    autoReconnectOnCommandTimeout: true,
    featureRoles: ["ignore", "main", "secondary", "tertiary", "vibration", "suction", "air", "rotation", "oscillation", "other"],
    autoAssignByLabel: true,
    labelSeparators: [" - ", " – ", " — ", "-", "–", "—"]
  };

  let TEMPLATES = [
    { id: "soft-wave", name: "Soft wave", description: "Gentle rolling power on active outputs.", compatible: "1+ outputs" },
    { id: "pulse", name: "Pulse", description: "Repeated short pulses on main/active outputs.", compatible: "1+ outputs" },
    { id: "heartbeat", name: "Heartbeat", description: "Two quick beats, then a pause.", compatible: "1+ outputs" },
    { id: "ramp-up", name: "Ramp up", description: "Slowly climbs from low to max preview power.", compatible: "1+ outputs" },
    { id: "rollercoaster", name: "Rollercoaster", description: "Rises and drops in uneven waves.", compatible: "1+ outputs" },
    { id: "tease", name: "Tease", description: "Low power with occasional slightly stronger taps.", compatible: "1+ outputs" },
    { id: "alternating", name: "Alternating outputs", description: "Alternates/chases across mapped active outputs.", compatible: "2+ outputs" },
    { id: "random-chaos", name: "Random chaos", description: "Randomized feature values. Keep max power conservative.", compatible: "1+ outputs" },
    { id: "all-steady", name: "All outputs steady", description: "All active outputs at steady preview power.", compatible: "1+ outputs" }
  ];

  const els = {
    scanBtn: document.getElementById("scanBtn"),
    stopAllBtn: document.getElementById("stopAllBtn"),
    wsStatus: document.getElementById("wsStatus"),
    serverStatus: document.getElementById("serverStatus"),
    deviceCount: document.getElementById("deviceCount"),
    mappingStatus: document.getElementById("mappingStatus"),
    cacheStatus: document.getElementById("cacheStatus"),
    playerList: document.getElementById("playerList"),
    deviceList: document.getElementById("deviceList"),
    rawCommand: document.getElementById("rawCommand"),
    sendRawBtn: document.getElementById("sendRawBtn"),
    copyLogBtn: document.getElementById("copyLogBtn"),
    clearLogBtn: document.getElementById("clearLogBtn"),
    logOutput: document.getElementById("logOutput"),
    templateSelect: document.getElementById("templateSelect"),
    templateDescription: document.getElementById("templateDescription"),
    templateFlowGraph: document.getElementById("templateFlowGraph"),
    templateFlowLegend: document.getElementById("templateFlowLegend"),
    templateFlowContext: document.getElementById("templateFlowContext"),
    templateDuration: document.getElementById("templateDuration"),
    templatePower: document.getElementById("templatePower"),
    previewSelectedBtn: document.getElementById("previewSelectedBtn"),
    previewAllBtn: document.getElementById("previewAllBtn"),
    saveMappingsBtn: document.getElementById("saveMappingsBtn"),
    exportCacheBtn: document.getElementById("exportCacheBtn"),
    importCacheBtn: document.getElementById("importCacheBtn"),
    importCacheFile: document.getElementById("importCacheFile"),
    resetCacheBtn: document.getElementById("resetCacheBtn"),
    templateSpeed: document.getElementById("templateSpeed"),
    templateRepeats: document.getElementById("templateRepeats"),
    templateLoop: document.getElementById("templateLoop"),
    stopPreviewBtn: document.getElementById("stopPreviewBtn"),
    heartbeatStatus: document.getElementById("heartbeatStatus"),
    latencyStatus: document.getElementById("latencyStatus"),
    currentPatternStatus: document.getElementById("currentPatternStatus"),
    liveMonitor: document.getElementById("liveMonitor"),
    keepAwakeStatus: document.getElementById("keepAwakeStatus")
  };

  const state = {
    ws: null,
    nextId: 1,
    pending: new Map(),
    devices: new Map(),
    players: [],
    config: { ...DEFAULTS },
    mappings: {},
    cache: { profiles: {} },
    selectedDeviceIndex: null,
    previewTimers: [],
    logLines: [],
    commandQueue: Promise.resolve(),
    busyCount: 0,
    lastCommandAt: 0,
    heartbeatTimer: null,
    lastHeartbeatOkAt: null,
    heartbeatLatencyMs: null,
    previewRunId: 0,
    currentPattern: null,
    deviceRuntime: new Map(),
    capabilities: { devices: {} },
    serverRuntime: null,
    runtimeDevices: [],
    runtimeDeviceSignature: "",
    deviceListInteractionUntil: 0,
    statePollTimer: null
  };

  function log(message, data = null, level = "info") {
    const time = new Date().toLocaleTimeString();
    const suffix = data === null || data === undefined ? "" : ` ${safeJson(data)}`;
    const line = `[${time}] ${level.toUpperCase()} ${message}${suffix}`;
    state.logLines.push(line);
    if (state.logLines.length > 500) state.logLines.shift();
    if (level === "error") renderLiveMonitor();
    if (els.logOutput) {
      els.logOutput.textContent = state.logLines.join("\n");
      els.logOutput.scrollTop = els.logOutput.scrollHeight;
    }
  }

  function safeJson(value) {
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  function messageName(message) {
    if (!message || typeof message !== "object") return "";
    return Object.keys(message)[0] || "";
  }

  function messagePayload(message) {
    const name = messageName(message);
    return name ? message[name] : null;
  }

  function makeMessage(name, payload = {}) {
    const id = payload.Id || state.nextId++;
    return { [name]: { ...payload, Id: id } };
  }

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function beginBusy() {
    state.busyCount += 1;
    renderButtons();
  }

  function endBusy() {
    state.busyCount = Math.max(0, state.busyCount - 1);
    renderButtons();
  }

  function rejectAllPending(reason) {
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    state.pending.clear();
  }

  function hardResetConnection(reason = "Connection reset") {
    stopHeartbeat();
    stopPreviewTimers();
    rejectAllPending(reason);
    try {
      if (state.ws) {
        state.ws.onopen = null;
        state.ws.onmessage = null;
        state.ws.onerror = null;
        state.ws.onclose = null;
        state.ws.close();
      }
    } catch {}
    state.ws = null;
    setStatus("Disconnected");
    renderButtons();
    log(reason, null, "warn");
  }

  async function sendMessages(messages, { waitForId = null, timeoutMs = null } = {}) {
    const normalized = Array.isArray(messages) ? messages : [messages];
    beginBusy();
    try {
      const res = await fetch("/api/intiface/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: normalized, waitForResponse: true, timeoutMs })
      });
      const data = await res.json().catch(() => ({}));
      if (data.runtime) applyRuntimeSnapshot(data.runtime);
      else if (Array.isArray(data.devices)) applyRuntimeSnapshot({ ready: true, state: "ready", devices: data.devices });
      if (!res.ok) throw new Error(data.error || res.statusText || "Intiface command failed");
      log("Sent through OSR server", normalized);
      return data.response || null;
    } finally {
      endBusy();
    }
  }

  async function sendRequest(name, payload = {}, opts = {}) {
    const msg = makeMessage(name, payload);
    const id = msg[name].Id;
    return await sendMessages(msg, { waitForId: id, ...opts });
  }

  function resolvePending(payload, envelope) {
    const id = payload?.Id;
    if (!id || !state.pending.has(id)) return;
    const pending = state.pending.get(id);
    clearTimeout(pending.timeout);
    state.pending.delete(id);
    const name = messageName(envelope);
    if (name === "Error") pending.reject(new Error(payload.ErrorMessage || payload.ErrorCode || "Buttplug error"));
    else pending.resolve(envelope);
  }

  function handleWsMessage(event) {
    let messages;
    try { messages = JSON.parse(event.data); } catch (err) { log("Could not parse Intiface message", err.message, "error"); return; }
    if (!Array.isArray(messages)) messages = [messages];
    for (const msg of messages) {
      const name = messageName(msg);
      const payload = messagePayload(msg);
      log("Received", msg);
      resolvePending(payload, msg);
      if (name === "ServerInfo") {
        if (els.serverStatus) els.serverStatus.textContent = `${payload.ServerName || "Intiface"} v${payload.MessageVersion ?? "?"}`;
      } else if (name === "DeviceList") {
        state.devices.clear();
        for (const device of payload.Devices || []) upsertDevice(device);
        renderDevices();
      } else if (name === "DeviceAdded") {
        upsertDevice(payload);
        renderDevices();
      } else if (name === "DeviceRemoved") {
        state.devices.delete(Number(payload.DeviceIndex));
        renderDevices();
      } else if (name === "ScanningFinished") {
        log("Scanning finished");
      } else if (name === "Error") {
        log("Intiface error", payload, "error");
      }
    }
  }

  function upsertDevice(raw) {
    const index = Number(raw.DeviceIndex);
    if (!Number.isFinite(index)) return;
    const device = { ...raw, DeviceIndex: index, features: extractOutputFeatures(raw) };
    device.cacheKey = deviceCacheKey(device);
    state.devices.set(index, device);
    if (!state.deviceRuntime.has(index)) state.deviceRuntime.set(index, { connectedAt: new Date().toISOString(), lastCommand: "None", lastCommandAt: null, errors: 0, battery: null, rssi: null });
    recordCapabilities().catch(err => log("Capability database update failed", err.message, "warn"));
    applyCachedProfile(device);
    applyAutoAssignment(device, { preserveManual: true });
    if (state.selectedDeviceIndex === null) state.selectedDeviceIndex = index;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && Array.isArray(value.Features)) return value.Features;
    return [];
  }

  function normalizeActuatorType(value, fallback = "Unknown") {
    return String(value || fallback || "Unknown").replace(/[^a-z0-9 _/-]/gi, "").trim() || "Unknown";
  }

  function deviceDisplayLabel(device) {
    return String(device?.DeviceDisplayName || device?.DeviceName || `Device ${device?.DeviceIndex ?? ""}`).trim();
  }

  function deviceModelName(device) {
    return String(device?.DeviceName || device?.DeviceDisplayName || "Unknown model").trim();
  }

  function defaultProfileSettings() {
    return {
      enabled: true,
      preferredTemplate: "soft-wave",
      intensityMultiplier: 100,
      notes: ""
    };
  }

  function profileSettingsForDevice(deviceIndex) {
    const mapping = mappingForDevice(deviceIndex);
    mapping.profile = mapping.profile && typeof mapping.profile === "object" ? mapping.profile : {};
    const defaults = defaultProfileSettings();
    const configuredMultiplier = Number(mapping.profile.intensityMultiplier ?? defaults.intensityMultiplier);
    mapping.profile = {
      ...defaults,
      ...mapping.profile,
      enabled: mapping.profile.enabled !== false,
      intensityMultiplier: Math.max(0, Math.min(100, Number.isFinite(configuredMultiplier) ? configuredMultiplier : defaults.intensityMultiplier)),
      preferredTemplate: String(mapping.profile.preferredTemplate || defaults.preferredTemplate),
      notes: String(mapping.profile.notes || "")
    };
    return mapping.profile;
  }


  function featureKey(deviceIndex, feature) {
    return `${deviceIndex}:${feature.command}:${feature.featureIndex}:${feature.actuatorType}`;
  }

  function stableFeatureKey(feature) {
    return [feature.command, feature.featureIndex, feature.actuatorType, feature.descriptor || ""].map(value => String(value ?? "").toLowerCase()).join(":");
  }

  function deviceCacheKey(device) {
    const features = (device.features || []).map(stableFeatureKey).join("|");
    const display = String(device.DeviceDisplayName || "").trim().toLowerCase();
    const name = String(device.DeviceName || "").trim().toLowerCase();
    return [display, name, features].join("||");
  }

  function makeCachedProfile(device, mapping) {
    const featureRoles = {};
    for (const feature of device.features || []) {
      const liveKey = featureKey(device.DeviceIndex, feature);
      featureRoles[stableFeatureKey(feature)] = mapping.features?.[liveKey] || roleForFeature(device.DeviceIndex, feature);
    }
    return {
      cacheKey: deviceCacheKey(device),
      deviceName: device.DeviceName || "",
      deviceDisplayName: device.DeviceDisplayName || "",
      displayName: deviceDisplayLabel(device),
      model: deviceModelName(device),
      deviceLabel: mapping.deviceLabel || deviceDisplayLabel(device),
      playerId: mapping.playerId || "",
      assignmentSource: mapping.assignmentSource || (mapping.playerId ? "manual" : ""),
      assignmentReason: mapping.assignmentReason || "",
      autoMatch: mapping.autoMatch || null,
      profile: profileSettingsForDevice(device.DeviceIndex),
      featureRoles,
      featureSummary: (device.features || []).map(feature => ({ command: feature.command, featureIndex: feature.featureIndex, actuatorType: feature.actuatorType, descriptor: feature.descriptor || "", stepCount: feature.stepCount || 0 })),
      updatedAt: new Date().toISOString()
    };
  }

  function applyCachedProfile(device) {
    if (!device || !IS_SETUP) return;
    const cacheKey = deviceCacheKey(device);
    const profile = state.cache?.profiles?.[cacheKey];
    if (!profile) return;
    const mapping = mappingForDevice(device.DeviceIndex);
    if (!mapping.deviceLabel && profile.deviceLabel && profile.deviceLabel !== profile.deviceName) mapping.deviceLabel = profile.deviceLabel;
    if (!mapping.playerId && profile.playerId) mapping.playerId = profile.playerId;
    if (!mapping.assignmentSource && profile.playerId) mapping.assignmentSource = profile.assignmentSource || "manual";
    if (!mapping.assignmentReason && profile.assignmentReason) mapping.assignmentReason = profile.assignmentReason;
    if (!mapping.autoMatch && profile.autoMatch) mapping.autoMatch = profile.autoMatch;
    if (profile.profile && typeof profile.profile === "object") mapping.profile = { ...defaultProfileSettings(), ...profile.profile };
    mapping.cacheKey = cacheKey;
    mapping.cachedAt = profile.updatedAt || null;
    mapping.features = mapping.features && typeof mapping.features === "object" ? mapping.features : {};
    for (const feature of device.features || []) {
      const liveKey = featureKey(device.DeviceIndex, feature);
      const savedRole = profile.featureRoles?.[stableFeatureKey(feature)];
      if (!mapping.features[liveKey] && savedRole) mapping.features[liveKey] = savedRole;
    }
    applyAutoAssignment(device, { preserveManual: true });
    log("Applied cached Intiface profile", { displayName: deviceDisplayLabel(device), model: deviceModelName(device), cacheKey }, "info");
  }

  function extractOutputFeatures(device) {
    const messages = device.DeviceMessages || {};
    const features = [];
    const scalar = messages.ScalarCmd;
    const scalarFeatures = asArray(scalar);
    scalarFeatures.forEach((feature, index) => {
      features.push({
        command: "ScalarCmd",
        featureIndex: Number(feature.Index ?? feature.FeatureIndex ?? index),
        actuatorType: normalizeActuatorType(feature.ActuatorType, "Scalar"),
        descriptor: String(feature.FeatureDescriptor || feature.Description || ""),
        stepCount: Number(feature.StepCount || 0),
        min: 0,
        max: 1,
        raw: feature
      });
    });
    if (!features.length && scalar && Number.isFinite(Number(scalar.FeatureCount))) {
      for (let i = 0; i < Number(scalar.FeatureCount); i += 1) {
        features.push({ command: "ScalarCmd", featureIndex: i, actuatorType: "Scalar", descriptor: "Scalar output", stepCount: 0, min: 0, max: 1, raw: scalar });
      }
    }

    const legacy = [
      ["VibrateCmd", "Vibrate", "Speeds", "Speed"],
      ["RotateCmd", "Rotate", "Rotations", "Speed"],
      ["LinearCmd", "Linear", "Vectors", "Position"]
    ];
    for (const [command, actuatorType] of legacy) {
      if (features.some(f => f.command === "ScalarCmd" && f.actuatorType.toLowerCase() === actuatorType.toLowerCase())) continue;
      const msg = messages[command];
      const count = Number(msg?.FeatureCount || 0);
      for (let i = 0; i < count; i += 1) {
        features.push({ command, featureIndex: i, actuatorType, descriptor: `${actuatorType} output`, stepCount: 0, min: 0, max: 1, raw: msg });
      }
    }
    return features.sort((a, b) => String(a.actuatorType).localeCompare(String(b.actuatorType)) || a.featureIndex - b.featureIndex);
  }

  function wsOpen() {
    return Boolean(state.serverRuntime?.ready);
  }

  function setStatus(text) {
    if (els.wsStatus) els.wsStatus.textContent = text;
  }

  function stopHeartbeat() {
    if (state.statePollTimer) window.clearInterval(state.statePollTimer);
    state.statePollTimer = null;
  }

  function configurableDeviceSignature(devices) {
    return safeJson((Array.isArray(devices) ? devices : []).map(device => ({
      DeviceIndex: device.DeviceIndex,
      DeviceDisplayName: device.DeviceDisplayName || "",
      DeviceName: device.DeviceName || "",
      DeviceMessageTimingGap: device.DeviceMessageTimingGap || 0,
      DeviceMessages: device.DeviceMessages || {},
      features: device.features || []
    })));
  }

  function deviceListIsBeingUsed() {
    const active = document.activeElement;
    if (active && els.deviceList?.contains(active) && /^(SELECT|INPUT|TEXTAREA|BUTTON)$/.test(active.tagName)) return true;
    return Date.now() < state.deviceListInteractionUntil;
  }

  function applyRuntimeSnapshot(runtime) {
    if (!runtime || typeof runtime !== "object") return;
    state.serverRuntime = runtime;
    setStatus(runtime.state || (runtime.ready ? "ready" : "disconnected"));
    if (els.serverStatus) els.serverStatus.textContent = runtime.serverInfo?.ServerName || "Intiface Server";
    if (els.heartbeatStatus) els.heartbeatStatus.textContent = runtime.ready ? "Healthy" : (runtime.state || "Unavailable");
    if (els.latencyStatus) els.latencyStatus.textContent = Number.isFinite(runtime.lastHealthLatencyMs) ? `${runtime.lastHealthLatencyMs} ms` : "—";
    if (els.keepAwakeStatus) {
      const keep = runtime.deviceKeepAwake || {};
      els.keepAwakeStatus.textContent = keep.enabled
        ? `${keep.intervalMs ? Math.round(keep.intervalMs / 1000) : "?"}s idle STOP (${keep.lastRunAt ? "active" : "waiting"})`
        : "Disabled";
    }

    // Only rebuild configurable device cards when the actual device definition
    // changes. Replacing the DOM every two seconds closes native dropdowns and
    // interrupts text/number input on desktop and mobile browsers.
    const nextDevices = Array.isArray(runtime.devices) ? runtime.devices.slice() : [];
    const nextSignature = configurableDeviceSignature(nextDevices);
    const deviceDefinitionChanged = nextSignature !== state.runtimeDeviceSignature;
    state.runtimeDevices = nextDevices;

    if (deviceDefinitionChanged && !deviceListIsBeingUsed()) {
      state.runtimeDeviceSignature = nextSignature;
      state.devices.clear();
      for (const device of state.runtimeDevices) upsertDevice(device);
      renderDevices();
    }

    renderButtons();
    renderLiveMonitor();
  }

  async function pollServerState() {
    try {
      const res = await fetch("/api/intiface/state", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.runtime) applyRuntimeSnapshot(data.runtime);
      else if (Array.isArray(data.devices)) applyRuntimeSnapshot({ ready: true, state: "ready", devices: data.devices });
    } catch (err) {
      setStatus("OSR server unavailable");
      if (els.heartbeatStatus) els.heartbeatStatus.textContent = "Unknown";
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    pollServerState();
    state.statePollTimer = window.setInterval(pollServerState, 2000);
  }


  async function refreshDevices() {
    const res = await fetch("/api/intiface/scan", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.runtime) applyRuntimeSnapshot(data.runtime);
    if (!res.ok) throw new Error(data.error || res.statusText);
    log("Server-side Intiface scan requested");
  }

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function valueWithDeviceMultiplier(device, value) {
    const multiplier = Math.max(0, Math.min(100, Number(profileSettingsForDevice(Number(device?.DeviceIndex)).intensityMultiplier ?? 100))) / 100;
    return clamp01(clamp01(value) * multiplier);
  }

  function scalarMessage(device, feature, value) {
    return makeMessage("ScalarCmd", {
      DeviceIndex: Number(device.DeviceIndex),
      Scalars: [{ Index: Number(feature.featureIndex), Scalar: clamp01(value), ActuatorType: feature.actuatorType }]
    });
  }

  function legacyMessage(device, feature, value) {
    const v = clamp01(value);
    const payload = { DeviceIndex: Number(device.DeviceIndex) };
    if (feature.command === "VibrateCmd") payload.Speeds = [{ Index: Number(feature.featureIndex), Speed: v }];
    else if (feature.command === "RotateCmd") payload.Rotations = [{ Index: Number(feature.featureIndex), Speed: v, Clockwise: true }];
    else if (feature.command === "LinearCmd") payload.Vectors = [{ Index: Number(feature.featureIndex), Duration: 300, Position: v }];
    return makeMessage(feature.command, payload);
  }

  function featureCommand(device, feature, value) {
    return feature.command === "ScalarCmd" ? scalarMessage(device, feature, value) : legacyMessage(device, feature, value);
  }

  async function setFeature(device, feature, value) {
    const finalValue = valueWithDeviceMultiplier(device, value);
    const runtime = state.deviceRuntime.get(Number(device?.DeviceIndex));
    if (runtime) { runtime.lastCommand = `${feature?.actuatorType || feature?.command} #${feature?.featureIndex} ${(finalValue * 100).toFixed(0)}%`; runtime.lastCommandAt = new Date().toISOString(); }
    renderLiveMonitor();
    await sendMessages(featureCommand(device, feature, finalValue));
  }

  async function stopDevice(device) {
    stopPreviewTimers();
    if (!device) return;
    try {
      await sendMessages(makeMessage("StopDeviceCmd", { DeviceIndex: Number(device.DeviceIndex) }));
    } catch (err) {
      log("StopDeviceCmd failed; falling back to zeroing features", err.message, "warn");
      for (const feature of device.features || []) await setFeature(device, feature, 0).catch(e => log("Feature stop failed", e.message, "error"));
    }
  }

  async function stopAll() {
    stopPreviewTimers();
    if (!wsOpen()) return;
    try {
      await sendMessages(makeMessage("StopAllDevices", {}));
    } catch (err) {
      log("StopAllDevices failed; falling back to per-device stop", err.message, "warn");
      for (const device of state.devices.values()) await stopDevice(device).catch(e => log("Device stop failed", e.message, "error"));
    }
  }

  function renderButtons() {
    const connected = wsOpen();
    const busy = state.busyCount > 0;
    if (els.scanBtn) els.scanBtn.disabled = !connected || busy;
    if (els.stopAllBtn) els.stopAllBtn.disabled = !connected || busy;
    if (els.sendRawBtn) els.sendRawBtn.disabled = !connected || busy;
    if (els.previewSelectedBtn) els.previewSelectedBtn.disabled = !connected || busy;
    if (els.previewAllBtn) els.previewAllBtn.disabled = !connected || busy;
    if (els.stopPreviewBtn) els.stopPreviewBtn.disabled = !connected || !state.currentPattern;
    if (els.exportCacheBtn) els.exportCacheBtn.disabled = busy;
    if (els.importCacheBtn) els.importCacheBtn.disabled = busy;
    if (els.resetCacheBtn) els.resetCacheBtn.disabled = busy;
    document.body?.classList.toggle("is-busy", busy);
  }

  function mappingForDevice(deviceIndex) {
    const key = String(deviceIndex);
    if (!state.mappings[key]) state.mappings[key] = { playerId: "", deviceLabel: "", features: {}, assignmentSource: "", autoMatch: null, profile: defaultProfileSettings() };
    return state.mappings[key];
  }

  function roleForFeature(deviceIndex, feature) {
    const mapping = mappingForDevice(deviceIndex);
    return mapping.features[featureKey(deviceIndex, feature)] || autoRole(feature);
  }

  function autoRole(feature) {
    // Do not trust actuator labels or feature order as physical meaning.
    // New/unmapped outputs stay inactive until the host tests and maps them,
    // while cached explicit mappings are still restored automatically.
    return "ignore";
  }

  function activeFeatures(device) {
    return (device.features || []).filter(feature => roleForFeature(device.DeviceIndex, feature) !== "ignore");
  }

  function templateMinimumOutputs(template) {
    const text = String(template?.compatible || "");
    const match = text.match(/(\d+)\s*\+/);
    return match ? Math.max(1, Number(match[1]) || 1) : 1;
  }

  function compatibleFeatures(device, template) {
    const active = activeFeatures(device);
    const allowedRoles = Array.isArray(template?.roles) && template.roles.length
      ? new Set(template.roles.map(role => String(role || "").toLowerCase()))
      : null;
    const compatible = allowedRoles
      ? active.filter(feature => allowedRoles.has(String(roleForFeature(device.DeviceIndex, feature) || "").toLowerCase()))
      : active;
    return compatible.length >= templateMinimumOutputs(template) ? compatible : [];
  }

  function compatibilitySummary(device, template) {
    if (!template) return "No template selected.";
    const active = activeFeatures(device);
    const compatible = compatibleFeatures(device, template);
    const minimum = templateMinimumOutputs(template);
    if (!active.length) return `${template.name}: no active outputs. Map at least one output to a role other than ignore.`;
    if (!compatible.length) {
      return `${template.name}: incompatible with the current role mapping. Requires ${minimum}+ compatible output${minimum === 1 ? "" : "s"}.`;
    }
    return `${template.name}: ready for ${compatible.length} compatible output${compatible.length === 1 ? "" : "s"} (${compatible.map(feature => `${roleForFeature(device.DeviceIndex, feature)} #${feature.featureIndex}`).join(", ")}).`;
  }

  function roleOptions(selected) {
    const roles = Array.isArray(state.config.featureRoles) && state.config.featureRoles.length ? state.config.featureRoles : DEFAULTS.featureRoles;
    return roles.map(role => `<option value="${escapeHtml(role)}"${role === selected ? " selected" : ""}>${escapeHtml(role)}</option>`).join("");
  }


  function normalizeMatchValue(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s_]+/g, " ")
      .replace(/\s*[-–—]\s*/g, " - ")
      .trim();
  }

  function uniqueValues(values) {
    return Array.from(new Set(values.map(v => String(v || "").trim()).filter(Boolean)));
  }

  function splitNameCandidates(value) {
    const raw = String(value || "").trim();
    if (!raw) return [];
    const separators = Array.isArray(state.config.labelSeparators) && state.config.labelSeparators.length ? state.config.labelSeparators : DEFAULTS.labelSeparators;
    const parts = [raw];
    for (const sep of separators) {
      if (!sep || !raw.includes(sep)) continue;
      const split = raw.split(sep).map(part => part.trim()).filter(Boolean);
      if (split.length >= 2) {
        parts.push(split[0]);
        parts.push(split[split.length - 1]);
      }
    }
    const normalizedDash = raw.split(/\s*[-–—]\s*/).map(part => part.trim()).filter(Boolean);
    if (normalizedDash.length >= 2) {
      parts.push(normalizedDash[0]);
      parts.push(normalizedDash[normalizedDash.length - 1]);
    }
    return uniqueValues(parts);
  }

  function playerMatchNames(player) {
    const names = [];
    names.push(player?.name, player?.displayName, player?.label);
    if (player?.id && !String(player.id).startsWith("group:")) names.push(player.id);
    const devices = Array.isArray(player?.devices) ? player.devices : [];
    for (const device of devices) names.push(device?.name, device?.displayName, device?.label, device?.id);
    return uniqueValues(names);
  }

  function playerCandidateGroups(player) {
    const full = [];
    const suffix = [];
    const prefix = [];
    for (const name of playerMatchNames(player)) {
      full.push(name);
      const parts = splitNameCandidates(name);
      if (parts.length > 1) {
        prefix.push(parts[1] ? parts[1] : "");
        suffix.push(parts[2] ? parts[2] : parts[parts.length - 1]);
      }
    }
    return {
      full: uniqueValues(full),
      suffix: uniqueValues(suffix),
      prefix: uniqueValues(prefix)
    };
  }

  function toyLabelCandidates(device, mapping) {
    const primary = mapping?.deviceLabel || device?.DeviceDisplayName || "";
    const fallback = primary ? "" : (device?.DeviceName || "");
    const expanded = [];
    for (const value of [primary, fallback]) {
      if (!value) continue;
      expanded.push(value);
      expanded.push(...splitNameCandidates(value));
    }
    return uniqueValues(expanded);
  }

  function findUniquePlayerMatch(label) {
    const normalizedLabel = normalizeMatchValue(label);
    if (!normalizedLabel || !state.players.length) return { status: "none", label };
    const stages = [
      ["exact player/device name", player => playerCandidateGroups(player).full],
      ["suffix name", player => playerCandidateGroups(player).suffix],
      ["prefix/group name", player => playerCandidateGroups(player).prefix]
    ];
    for (const [reason, getter] of stages) {
      const matches = [];
      for (const player of state.players) {
        const candidates = getter(player).map(normalizeMatchValue);
        if (candidates.includes(normalizedLabel)) matches.push(player);
      }
      const unique = [];
      const seen = new Set();
      for (const player of matches) {
        const id = String(player.id || player.name || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unique.push(player);
      }
      if (unique.length === 1) return { status: "matched", player: unique[0], reason, label };
      if (unique.length > 1) return { status: "ambiguous", matches: unique, reason, label };
    }
    return { status: "none", label };
  }

  function autoAssignmentForDevice(device, mapping) {
    if (!IS_SETUP || state.config.autoAssignByLabel === false) return { status: "disabled" };
    for (const label of toyLabelCandidates(device, mapping)) {
      const match = findUniquePlayerMatch(label);
      if (match.status !== "none") return match;
    }
    return { status: "none" };
  }

  function applyAutoAssignment(device, { preserveManual = true } = {}) {
    if (!device || !IS_SETUP) return;
    const mapping = mappingForDevice(device.DeviceIndex);
    if (preserveManual && mapping.assignmentSource === "manual") return;
    if (preserveManual && mapping.playerId && !mapping.assignmentSource) {
      mapping.assignmentSource = "manual";
      mapping.assignmentReason = "Existing saved mapping";
      return;
    }
    const match = autoAssignmentForDevice(device, mapping);
    mapping.autoMatch = match;
    if (match.status === "matched") {
      mapping.playerId = String(match.player.id || "");
      mapping.assignmentSource = "auto";
      mapping.assignmentReason = `Auto matched by ${match.reason}: ${match.label}`;
    } else if (mapping.assignmentSource === "auto") {
      mapping.playerId = "";
      mapping.assignmentSource = "";
      mapping.assignmentReason = match.status === "ambiguous" ? `Ambiguous label: ${match.label}` : "No label match";
    }
  }

  function assignmentSummary(device, mapping) {
    const player = state.players.find(p => String(p.id) === String(mapping.playerId));
    const match = mapping.autoMatch || autoAssignmentForDevice(device, mapping);
    if (mapping.assignmentSource === "manual") {
      return `<div class="assignment-status manual"><strong>Manual</strong><span>${player ? escapeHtml(player.name) : (mapping.playerId ? escapeHtml(mapping.playerId) : "Manually unassigned")}</span></div>`;
    }
    if (mapping.assignmentSource === "auto" && player) {
      return `<div class="assignment-status auto"><strong>Auto assigned</strong><span>${escapeHtml(player.name)} · ${escapeHtml(mapping.assignmentReason || "label match")}</span></div>`;
    }
    if (match.status === "ambiguous") {
      const names = (match.matches || []).map(p => p.name || p.id).join(", ");
      return `<div class="assignment-status ambiguous"><strong>Ambiguous</strong><span>Label ${escapeHtml(match.label)} matched multiple players: ${escapeHtml(names)}</span></div>`;
    }
    return `<div class="assignment-status none"><strong>Not assigned</strong><span>No clear label match found. Pick a player manually or change the toy label.</span></div>`;
  }

  function templateOptions(selected) {
    return TEMPLATES.map(t => `<option value="${escapeHtml(t.id)}"${String(t.id) === String(selected) ? " selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
  }

  function playerOptions(selected) {
    const opts = [`<option value="">No player assigned</option>`];
    for (const player of state.players) {
      opts.push(`<option value="${escapeHtml(player.id)}"${String(player.id) === String(selected) ? " selected" : ""}>${escapeHtml(player.name)}</option>`);
    }
    return opts.join("");
  }

  function renderPlayers() {
    if (!els.playerList) return;
    if (!state.players.length) {
      els.playerList.textContent = "No players loaded yet. The setup page can still test devices.";
      return;
    }
    els.playerList.innerHTML = state.players.map(player => `<div class="player-pill"><strong>${escapeHtml(player.name)}</strong><br><span class="muted">${escapeHtml(player.id)}${player.isGrouped ? " · grouped" : ""}</span></div>`).join("");
  }

  function selectedTemplate() {
    const id = String(els.templateSelect?.value || "");
    return id ? (TEMPLATES.find(template => String(template.id) === id) || null) : null;
  }

  function renderTemplates() {
    if (!els.templateSelect) return;
    els.templateSelect.innerHTML = `<option value="">None</option>${TEMPLATES.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} · ${escapeHtml(t.compatible)}</option>`).join("")}`;
    const saved = localStorage.getItem("osr.intiface.template") || "";
    els.templateSelect.value = TEMPLATES.some(template => String(template.id) === saved) ? saved : "";
    if (els.templateDuration) els.templateDuration.value = String(state.config.defaultPreviewDurationMs || DEFAULTS.defaultPreviewDurationMs);
    updateTemplateDescription();
  }

  function updateTemplateDescription() {
    const template = selectedTemplate();
    if (els.templateDescription) els.templateDescription.textContent = template ? template.description : "No template selected.";
    if (template) localStorage.setItem("osr.intiface.template", template.id);
    else localStorage.removeItem("osr.intiface.template");
    renderTemplateFlowGraph();
    renderButtons();
  }

  function deterministicRandom(position, featurePosition) {
    const value = Math.sin((position + 1) * 1298.37 + (featurePosition + 1) * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function templateFlowFeatures(template) {
    const selected = state.devices.get(Number(state.selectedDeviceIndex));
    if (selected) {
      const features = compatibleFeatures(selected, template);
      if (features.length) return features.map(feature => ({
        label: `${roleForFeature(selected.DeviceIndex, feature)} #${feature.featureIndex}`,
        feature
      }));
    }
    const count = Math.max(1, templateMinimumOutputs(template));
    return Array.from({ length: count }, (_, index) => ({ label: count === 1 ? "Main" : `Output ${index + 1}`, feature: null }));
  }

  function renderTemplateFlowGraph() {
    if (!els.templateFlowGraph) return;
    const template = selectedTemplate();
    if (!template) {
      els.templateFlowGraph.classList.add("empty");
      els.templateFlowGraph.innerHTML = `<span>Select a template to preview its 10-second flow.</span>`;
      if (els.templateFlowLegend) els.templateFlowLegend.innerHTML = "";
      if (els.templateFlowContext) els.templateFlowContext.textContent = "Select a template to show its output curve.";
      els.templateFlowGraph.setAttribute("aria-label", "Empty template flow graph");
      return;
    }

    const outputs = templateFlowFeatures(template);
    const maxPower = Math.max(1, Math.min(100, Number(els.templatePower?.value || 45))) / 100;
    const width = 1000;
    const height = 280;
    const left = 58;
    const right = 18;
    const top = 18;
    const bottom = 38;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const samples = 101;
    const lines = outputs.map((output, outputIndex) => {
      const points = [];
      for (let sample = 0; sample < samples; sample += 1) {
        const position = sample / (samples - 1);
        const value = (template.mode === "random-chaos" || template.mode === "random" || template.id === "random-chaos")
          ? deterministicRandom(position * 100, outputIndex) * maxPower
          : templateValue(template.mode || template.id, position, outputIndex, outputs.length, maxPower);
        const x = left + position * plotWidth;
        const y = top + (1 - Math.max(0, Math.min(1, value))) * plotHeight;
        points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      return `<polyline class="template-flow-line line-${outputIndex % 4}" points="${points.join(" ")}" />`;
    }).join("");

    const xGrid = Array.from({ length: 11 }, (_, second) => {
      const x = left + (second / 10) * plotWidth;
      return `<line class="template-flow-grid" x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}"/><text class="template-flow-axis" x="${x}" y="${height - 12}" text-anchor="middle">${second}s</text>`;
    }).join("");
    const yGrid = [0, 25, 50, 75, 100].map(percent => {
      const y = top + (1 - percent / 100) * plotHeight;
      return `<line class="template-flow-grid" x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}"/><text class="template-flow-axis" x="${left - 10}" y="${y + 4}" text-anchor="end">${percent}%</text>`;
    }).join("");

    els.templateFlowGraph.classList.remove("empty");
    els.templateFlowGraph.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${xGrid}${yGrid}${lines}</svg>`;
    els.templateFlowGraph.setAttribute("aria-label", `${template.name} template output over ten seconds`);
    if (els.templateFlowLegend) els.templateFlowLegend.innerHTML = outputs.map((output, index) => `<span><i class="line-${index % 4}"></i>${escapeHtml(output.label)}</span>`).join("");
    const selected = state.devices.get(Number(state.selectedDeviceIndex));
    if (els.templateFlowContext) els.templateFlowContext.textContent = selected
      ? `${template.name} adapted to ${deviceDisplayLabel(selected)}.`
      : `${template.name} shown with ${outputs.length} generic output${outputs.length === 1 ? "" : "s"}. Select a device to see its role mapping.`;
  }

  function renderDevices() {
    // Self-heal the configurable registry from the server runtime. This keeps
    // the setup cards and live monitor on the exact same device source.
    if (!state.devices.size && state.runtimeDevices.length) {
      for (const device of state.runtimeDevices) upsertDevice(device);
    }

    if (els.deviceCount) els.deviceCount.textContent = String(state.devices.size);
    if (!els.deviceList) return;
    if (!state.devices.size) {
      els.deviceList.className = "device-list empty";
      els.deviceList.textContent = wsOpen()
        ? "Connected to Intiface, but the server currently reports no configurable devices. Use Scan / Refresh Devices."
        : "No devices detected yet.";
      return;
    }

    els.deviceList.className = "device-list";
    const cards = [];
    for (const device of state.devices.values()) {
      try {
        cards.push(renderDeviceCard(device));
      } catch (err) {
        cards.push(`<article class="device-card error-card"><div class="device-head"><div class="device-title"><h3>${escapeHtml(deviceDisplayLabel(device))}</h3><span class="badge warn">Could not render configuration</span></div></div><div class="device-body"><p>${escapeHtml(err.message || String(err))}</p><details><summary>Raw device JSON</summary><pre class="raw-json"><code>${escapeHtml(JSON.stringify(device, null, 2))}</code></pre></details></div></article>`);
        log("Could not render configurable device", { deviceIndex: device.DeviceIndex, error: err.message || String(err) }, "error");
      }
    }
    els.deviceList.innerHTML = cards.join("");
    attachDeviceHandlers();
  }

  function renderDeviceCard(device) {
    applyAutoAssignment(device, { preserveManual: true });
    const mapping = mappingForDevice(device.DeviceIndex);
    const features = device.features || [];
    const selected = String(state.selectedDeviceIndex) === String(device.DeviceIndex);
    const cached = Boolean(state.cache?.profiles?.[device.cacheKey]);
    const badges = features.length ? features.map(f => `<span class="badge ok">${escapeHtml(f.actuatorType)} #${f.featureIndex}</span>`).join("") : `<span class="badge warn">No output features found</span>`;
    const cacheBadge = cached ? `<span class="badge ok">Cached profile</span>` : `<span class="badge warn">No cache yet</span>`;
    const profile = profileSettingsForDevice(device.DeviceIndex);
    const mappingHtml = IS_SETUP ? `
      <div class="assignment-wrap">
        ${assignmentSummary(device, mapping)}
        <div class="mapping-grid">
          <label class="field"><span>Assigned player</span><select data-map-player="${device.DeviceIndex}">${playerOptions(mapping.playerId)}</select></label>
          <label class="field"><span>Display name / auto-match label</span><input data-map-label="${device.DeviceIndex}" value="${escapeHtml(mapping.deviceLabel || deviceDisplayLabel(device))}" /></label>
          <label class="field"><span>Preferred template</span><select data-profile-template="${device.DeviceIndex}">${templateOptions(profile.preferredTemplate)}</select></label>
          <label class="field"><span>Intensity multiplier %</span><input type="number" min="0" max="100" value="${escapeHtml(profile.intensityMultiplier)}" data-profile-intensity="${device.DeviceIndex}" /></label>
          <label class="field checkbox-field"><input type="checkbox" data-profile-enabled="${device.DeviceIndex}"${profile.enabled ? " checked" : ""} /><span>Enable this toy profile</span></label>
          <label class="field profile-notes"><span>Notes</span><textarea rows="2" data-profile-notes="${device.DeviceIndex}" placeholder="Optional notes for this toy">${escapeHtml(profile.notes)}</textarea></label>
          <label class="field"><span>Preview / assignment tools</span><span class="button-row"><button class="secondary" data-select-device="${device.DeviceIndex}">${selected ? "Selected" : "Select for preview"}</button><button class="secondary" data-clear-manual="${device.DeviceIndex}">Clear manual</button><button class="secondary" data-forget-cache="${device.DeviceIndex}">Forget this toy</button></span></label>
        </div>
      </div>` : "";
    const featureHtml = features.length ? features.map(feature => renderFeature(device, feature)).join("") : `<p class="muted">This device did not report ScalarCmd or legacy output features.</p>`;
    return `
      <article class="device-card" data-device-index="${device.DeviceIndex}">
        <div class="device-head">
          <div class="device-title">
            <h3>${escapeHtml(deviceDisplayLabel(device))}</h3>
            <span class="muted">DisplayName: ${escapeHtml(device.DeviceDisplayName || "(none)")}</span>
            <span class="muted">Model: ${escapeHtml(deviceModelName(device))} · DeviceIndex ${device.DeviceIndex}</span>
            <span class="muted">Cache key: ${escapeHtml(device.cacheKey || "not built")}</span>
            <div class="badge-row">${badges}${cacheBadge}</div>
          </div>
          <div class="button-row">
            <button data-test-all-active="${device.DeviceIndex}">Test All Active Features</button>
            <button class="secondary" data-stop-device="${device.DeviceIndex}">Stop Device</button>
          </div>
        </div>
        <div class="device-body">
          ${mappingHtml}
          <div class="compatibility-note">${escapeHtml(compatibilitySummary(device, selectedTemplate() || TEMPLATES.find(item => item.id === profile.preferredTemplate) || null))}</div>
          <div class="feature-grid">${featureHtml}</div>
          <details>
            <summary>Raw device JSON</summary>
            <pre class="raw-json"><code>${escapeHtml(JSON.stringify(device, null, 2))}</code></pre>
          </details>
        </div>
      </article>`;
  }

  function renderFeature(device, feature) {
    const role = roleForFeature(device.DeviceIndex, feature);
    const key = featureKey(device.DeviceIndex, feature);
    const roleHtml = IS_SETUP ? `<label class="field"><span>Manual role</span><select data-feature-role="${escapeHtml(key)}" data-device-index="${device.DeviceIndex}">${roleOptions(role)}</select></label>` : "";
    return `
      <div class="feature-card">
        <header>
          <strong>${escapeHtml(feature.actuatorType)}</strong>
          <code>#${feature.featureIndex}</code>
        </header>
        <div class="range-meta">Command: ${escapeHtml(feature.command)}${feature.stepCount ? ` · Steps: ${feature.stepCount}` : ""}</div>
        ${feature.descriptor ? `<div class="muted">${escapeHtml(feature.descriptor)}</div>` : ""}
        ${roleHtml}
        <label class="field">
          <span>Power %</span>
          <div class="slider-row">
            <input type="range" min="0" max="100" value="25" data-power-slider="${escapeHtml(key)}" />
            <input type="number" min="0" max="100" value="25" data-power-number="${escapeHtml(key)}" />
          </div>
        </label>
        <div class="button-row">
          <button data-test-feature="${escapeHtml(key)}" data-device-index="${device.DeviceIndex}">Test Feature</button>
          <button class="secondary" data-zero-feature="${escapeHtml(key)}" data-device-index="${device.DeviceIndex}">Zero</button>
        </div>
      </div>`;
  }

  function attachDeviceHandlers() {
    els.deviceList.querySelectorAll("[data-stop-device]").forEach(btn => btn.addEventListener("click", async () => {
      const device = state.devices.get(Number(btn.dataset.stopDevice));
      await stopDevice(device).catch(err => log("Stop failed", err.message, "error"));
    }));
    els.deviceList.querySelectorAll("[data-select-device]").forEach(btn => btn.addEventListener("click", () => {
      state.selectedDeviceIndex = Number(btn.dataset.selectDevice);
      renderDevices();
    }));
    els.deviceList.querySelectorAll("[data-map-player]").forEach(select => select.addEventListener("change", () => {
      const mapping = mappingForDevice(select.dataset.mapPlayer);
      mapping.playerId = select.value;
      mapping.assignmentSource = "manual";
      mapping.assignmentReason = select.value ? "Manual dropdown assignment" : "Manually unassigned";
      markMappingDirty();
      renderDevices();
    }));
    els.deviceList.querySelectorAll("[data-map-label]").forEach(input => input.addEventListener("input", () => {
      const device = state.devices.get(Number(input.dataset.mapLabel));
      const mapping = mappingForDevice(input.dataset.mapLabel);
      mapping.deviceLabel = input.value;
      if (mapping.assignmentSource !== "manual") applyAutoAssignment(device, { preserveManual: true });
      markMappingDirty();
      renderDevices();
    }));
    els.deviceList.querySelectorAll("[data-clear-manual]").forEach(btn => btn.addEventListener("click", () => {
      const device = state.devices.get(Number(btn.dataset.clearManual));
      const mapping = mappingForDevice(btn.dataset.clearManual);
      mapping.playerId = "";
      mapping.assignmentSource = "";
      mapping.assignmentReason = "";
      mapping.autoMatch = null;
      applyAutoAssignment(device, { preserveManual: false });
      markMappingDirty();
      renderDevices();
    }));
    els.deviceList.querySelectorAll("[data-forget-cache]").forEach(btn => btn.addEventListener("click", async () => {
      const device = state.devices.get(Number(btn.dataset.forgetCache));
      if (!device) return;
      await forgetCachedDevice(device).catch(err => log("Forget cached toy failed", err.message, "error"));
    }));
    els.deviceList.querySelectorAll("[data-profile-template]").forEach(select => select.addEventListener("change", () => {
      profileSettingsForDevice(select.dataset.profileTemplate).preferredTemplate = select.value;
      markMappingDirty();
    }));
    els.deviceList.querySelectorAll("[data-profile-intensity]").forEach(input => input.addEventListener("input", () => {
      const profile = profileSettingsForDevice(input.dataset.profileIntensity);
      profile.intensityMultiplier = Math.max(0, Math.min(100, Number(input.value) || 0));
      markMappingDirty();
    }));
    els.deviceList.querySelectorAll("[data-profile-enabled]").forEach(input => input.addEventListener("change", () => {
      profileSettingsForDevice(input.dataset.profileEnabled).enabled = Boolean(input.checked);
      markMappingDirty();
    }));
    els.deviceList.querySelectorAll("[data-profile-notes]").forEach(input => input.addEventListener("input", () => {
      profileSettingsForDevice(input.dataset.profileNotes).notes = input.value;
      markMappingDirty();
    }));
    els.deviceList.querySelectorAll("[data-feature-role]").forEach(select => select.addEventListener("change", () => {
      const mapping = mappingForDevice(select.dataset.deviceIndex);
      mapping.features[select.dataset.featureRole] = select.value;
      markMappingDirty();
    }));
    els.deviceList.querySelectorAll("[data-power-slider]").forEach(slider => slider.addEventListener("input", () => {
      const number = els.deviceList.querySelector(`[data-power-number="${cssEscape(slider.dataset.powerSlider)}"]`);
      if (number) number.value = slider.value;
    }));
    els.deviceList.querySelectorAll("[data-power-number]").forEach(number => number.addEventListener("input", () => {
      const slider = els.deviceList.querySelector(`[data-power-slider="${cssEscape(number.dataset.powerNumber)}"]`);
      if (slider) slider.value = number.value;
    }));
    els.deviceList.querySelectorAll("[data-test-feature]").forEach(btn => btn.addEventListener("click", async () => {
      const device = state.devices.get(Number(btn.dataset.deviceIndex));
      const feature = findFeatureByKey(device, btn.dataset.testFeature);
      const power = Number(els.deviceList.querySelector(`[data-power-number="${cssEscape(btn.dataset.testFeature)}"]`)?.value || 25) / 100;
      await testFeatureMomentary(device, feature, power).catch(err => log("Feature test failed", err.message, "error"));
    }));
    els.deviceList.querySelectorAll("[data-test-all-active]").forEach(btn => btn.addEventListener("click", async () => {
      const device = state.devices.get(Number(btn.dataset.testAllActive));
      await testAllActiveFeaturesMomentary(device).catch(err => log("Active feature test failed", err.message, "error"));
    }));
    els.deviceList.querySelectorAll("[data-zero-feature]").forEach(btn => btn.addEventListener("click", async () => {
      const device = state.devices.get(Number(btn.dataset.deviceIndex));
      const feature = findFeatureByKey(device, btn.dataset.zeroFeature);
      await setFeature(device, feature, 0).catch(err => log("Zero failed", err.message, "error"));
    }));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/"/g, "\\\"");
  }

  function findFeatureByKey(device, key) {
    return (device?.features || []).find(feature => featureKey(device.DeviceIndex, feature) === key) || null;
  }

  async function testFeatureMomentary(device, feature, power) {
    if (!device || !feature) throw new Error("Missing device or feature");
    await setFeature(device, feature, power);
    window.setTimeout(() => setFeature(device, feature, 0).catch(err => log("Auto-zero failed", err.message, "error")), 700);
  }

  async function testAllActiveFeaturesMomentary(device) {
    if (!device) throw new Error("Missing device");
    const features = activeFeatures(device);
    if (!features.length) throw new Error("No active features. Map at least one feature to a role other than ignore first.");

    const values = features.map(feature => {
      const key = featureKey(device.DeviceIndex, feature);
      const rawPower = Number(els.deviceList.querySelector(`[data-power-number="${cssEscape(key)}"]`)?.value || 25) / 100;
      return { device, feature, value: clamp01(rawPower) };
    });
    const commands = featureValueCommands(values);
    if (!commands.length) throw new Error("No test commands could be built for the active features");

    const runtime = state.deviceRuntime.get(Number(device.DeviceIndex));
    if (runtime) {
      runtime.lastCommand = `Test all active (${features.length})`;
      runtime.lastCommandAt = new Date().toISOString();
    }
    renderLiveMonitor();
    await sendMessages(commands);

    window.setTimeout(() => {
      const zeroCommands = featureValueCommands(features.map(feature => ({ device, feature, value: 0 })));
      if (zeroCommands.length) sendMessages(zeroCommands).catch(err => log("Active feature auto-zero failed", err.message, "error"));
    }, 700);
  }

  function stopPreviewTimers() {
    while (state.previewTimers.length) window.clearTimeout(state.previewTimers.pop());
  }

  function schedule(delayMs, fn) {
    const timer = window.setTimeout(fn, delayMs);
    state.previewTimers.push(timer);
  }

  function featureValueCommands(values) {
    const commands = [];
    const scalarGroups = new Map();

    for (const item of values || []) {
      const device = item?.device;
      const feature = item?.feature;
      if (!device || !feature) continue;

      const finalValue = valueWithDeviceMultiplier(device, item.value);
      if (feature.command !== "ScalarCmd") {
        commands.push(legacyMessage(device, feature, finalValue));
        continue;
      }

      const deviceIndex = Number(device.DeviceIndex);
      if (!Number.isFinite(deviceIndex)) continue;
      if (!scalarGroups.has(deviceIndex)) scalarGroups.set(deviceIndex, []);
      scalarGroups.get(deviceIndex).push({
        Index: Number(feature.featureIndex),
        Scalar: finalValue,
        ActuatorType: feature.actuatorType
      });
    }

    for (const [deviceIndex, scalars] of scalarGroups) {
      if (!scalars.length) continue;
      commands.push(makeMessage("ScalarCmd", { DeviceIndex: deviceIndex, Scalars: scalars }));
    }

    return commands;
  }

  async function applyTemplateStep(devices, values) {
    const commands = featureValueCommands(values);
    if (commands.length) await sendMessages(commands).catch(err => log("Template step failed", err.message, "error"));
  }

  function templateValue(templateMode, position, featurePosition, featureCount, maxPower) {
    const p = Math.max(0, Math.min(1, position));
    const max = Math.max(0.01, Math.min(1, maxPower));
    if (templateMode === "all-steady") return max;
    if (templateMode === "ramp-up" || templateMode === "ramp") return max * p;
    if (templateMode === "tease") return max * (p % 0.25 < 0.05 ? 0.72 : 0.22);
    if (templateMode === "pulse") return (p % 0.22 < 0.1) ? max : 0;
    if (templateMode === "heartbeat") {
      const beat = p % 0.34;
      return (beat < 0.055 || (beat > 0.11 && beat < 0.17)) ? max : 0;
    }
    if (templateMode === "rollercoaster") return max * (0.15 + 0.85 * Math.abs(Math.sin(p * Math.PI * 3.5)));
    if (templateMode === "alternating") return featurePosition === Math.floor(p * Math.max(1, featureCount) * 3) % Math.max(1, featureCount) ? max : 0;
    if (templateMode === "random-chaos" || templateMode === "random") return Math.random() * max;
    return max * (0.2 + 0.8 * (0.5 + 0.5 * Math.sin((p * Math.PI * 2) + featurePosition)));
  }

  async function previewTemplate(targetDevices) {
    if (!wsOpen()) throw new Error("Not connected");
    await stopPreview({ stopDevices: true, quiet: true });
    const template = selectedTemplate();
    if (!template) throw new Error("Select a template first");
    const baseDuration = Math.min(Number(els.templateDuration?.value || DEFAULTS.defaultPreviewDurationMs), Number(state.config.maxPreviewDurationMs || DEFAULTS.maxPreviewDurationMs));
    const speed = Math.max(25, Math.min(300, Number(els.templateSpeed?.value || 100))) / 100;
    const duration = Math.max(300, Math.round(baseDuration / speed));
    const repeats = Math.max(1, Math.min(20, Number(els.templateRepeats?.value || 1)));
    const loop = Boolean(els.templateLoop?.checked);
    const maxPower = Math.max(1, Math.min(100, Number(els.templatePower?.value || 45))) / 100;
    const runId = ++state.previewRunId;
    state.currentPattern = { id: template.id, name: template.name, startedAt: new Date().toISOString(), loop, repeats, devices: targetDevices.map(device => deviceDisplayLabel(device)) };
    if (els.currentPatternStatus) els.currentPatternStatus.textContent = `${template.name}${loop ? " · loop" : repeats > 1 ? ` · x${repeats}` : ""}`;
    renderLiveMonitor();
    log(`Preview template ${template.id}`, { duration, speed, repeats, loop, maxPower });

    const runOnce = async () => {
      const featureItems = [];
      for (const device of targetDevices) for (const feature of compatibleFeatures(device, template)) featureItems.push({ device, feature });
      if (!featureItems.length) throw new Error("No compatible active output features selected");
      const interval = Math.max(60, Math.round(Number(template.intervalMs || 180) / speed));
      const steps = Math.max(1, Math.ceil(duration / interval));
      for (let step = 0; step <= steps && state.previewRunId === runId; step += 1) {
        const p = step / steps;
        const values = featureItems.map((item, index) => ({ ...item, value: templateValue(template.mode || template.id, p, index, featureItems.length, maxPower) }));
        await applyTemplateStep(targetDevices, values);
        await sleep(interval);
      }
    };

    let completed = 0;
    do {
      await runOnce();
      completed += 1;
    } while (state.previewRunId === runId && (loop || completed < repeats));
    if (state.previewRunId === runId) await stopPreview({ stopDevices: true, quiet: true });
  }

  async function stopPreview({ stopDevices = true, quiet = false } = {}) {
    state.previewRunId += 1;
    stopPreviewTimers();
    const wasRunning = Boolean(state.currentPattern);
    state.currentPattern = null;
    if (els.currentPatternStatus) els.currentPatternStatus.textContent = "Idle";
    renderButtons();
    renderLiveMonitor();
    if (stopDevices && wsOpen()) await Promise.all(Array.from(state.devices.values()).map(device => stopDevice(device))).catch(err => log("Preview stop failed", err.message, "error"));
    if (wasRunning && !quiet) log("Preview stopped");
  }

  function markMappingDirty() {
    if (els.mappingStatus) els.mappingStatus.textContent = "Unsaved changes";
  }

  function updateCacheStatus() {
    if (!els.cacheStatus) return;
    const count = Object.keys(state.cache?.profiles || {}).length;
    els.cacheStatus.textContent = count ? `${count} cached profile${count === 1 ? "" : "s"}` : "No cached profiles";
  }


  function capabilityKey(device) { return `${deviceModelName(device).toLowerCase()}||${(device.features || []).map(stableFeatureKey).join("|")}`; }

  async function recordCapabilities() {
    if (!IS_SETUP || !state.devices.size) return;
    const devices = Array.from(state.devices.values()).map(device => ({
      key: capabilityKey(device), model: deviceModelName(device), displayNames: [deviceDisplayLabel(device)],
      timingGapMs: Number(device.DeviceMessageTimingGap || 0),
      features: (device.features || []).map(feature => ({ command: feature.command, featureIndex: feature.featureIndex, actuatorType: feature.actuatorType, descriptor: feature.descriptor || "", stepCount: feature.stepCount || 0 })),
      sensorTypes: Object.values(device.DeviceMessages || {}).flatMap(value => Array.isArray(value) ? value : []).map(item => item?.SensorType).filter(Boolean)
    }));
    const res = await fetch("/api/intiface/capabilities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ devices }) });
    if (res.ok) state.capabilities = (await res.json()).capabilities || state.capabilities;
  }

  function playerNameForId(playerId) {
    const id = String(playerId || "");
    if (!id) return "None";
    const player = state.players.find(item => String(item.id) === id);
    return player?.name || id;
  }

  function renderLiveMonitor() {
    if (!els.liveMonitor) return;
    if (!state.devices.size) { els.liveMonitor.textContent = wsOpen() ? "Connected; no devices detected." : "Connect to Intiface to begin monitoring."; return; }
    els.liveMonitor.innerHTML = Array.from(state.devices.values()).map(device => {
      const runtime = state.deviceRuntime.get(device.DeviceIndex) || {};
      const profile = profileSettingsForDevice(device.DeviceIndex);
      return `<div class="monitor-card"><strong>${escapeHtml(deviceDisplayLabel(device))}</strong>
        <div class="metric"><span>Model</span><span>${escapeHtml(deviceModelName(device))}</span></div>
        <div class="metric"><span>Status</span><span>${wsOpen() ? "Connected" : "Disconnected"}</span></div>
        <div class="metric"><span>Mapped player</span><span>${escapeHtml(playerNameForId(mappingForDevice(device.DeviceIndex).playerId))}</span></div>
        <div class="metric"><span>Outputs</span><span>${activeFeatures(device).length} active / ${(device.features || []).length}</span></div>
        <div class="metric"><span>Multiplier</span><span>${escapeHtml(profile.intensityMultiplier)}%</span></div>
        <div class="metric"><span>Battery</span><span>${runtime.battery ?? "Not exposed"}</span></div>
        <div class="metric"><span>RSSI</span><span>${runtime.rssi ?? "Not exposed"}</span></div>
        <div class="metric"><span>Last command</span><span>${escapeHtml(runtime.lastCommand || "None")}</span></div>
        <div class="metric"><span>Errors</span><span>${runtime.errors || 0}</span></div></div>`;
    }).join("");
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function exportCache() {
    let cache = state.cache || { profiles: {} };
    try {
      const res = await fetch("/api/intiface/cache", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        cache = data.cache || cache;
      }
    } catch (err) {
      log("Could not fetch server cache; exporting local cache", err.message, "warn");
    }
    downloadJson(`osr-intiface-cache-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, cache);
  }

  async function importCacheFromFile(file) {
    if (!file) return;
    const text = await file.text();
    const incoming = JSON.parse(text);
    const cache = incoming && incoming.profiles ? incoming : { profiles: {} };
    const res = await fetch("/api/intiface/cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cache, mode: "merge" })
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const data = await res.json();
    state.cache = data.cache || cache;
    localStorage.setItem("osr.intiface.cache", JSON.stringify(state.cache));
    updateCacheStatus();
    renderDevices();
    log("Imported Intiface cache", { profiles: Object.keys(state.cache.profiles || {}).length });
  }

  async function resetCache() {
    if (!confirm("Reset the Intiface device cache? Current unsaved manual setup on screen will stay until reload, but cached profiles will be removed.")) return;
    const res = await fetch("/api/intiface/cache", { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const data = await res.json();
    state.cache = data.cache || { profiles: {} };
    localStorage.setItem("osr.intiface.cache", JSON.stringify(state.cache));
    updateCacheStatus();
    renderDevices();
    log("Reset Intiface cache");
  }

  async function forgetCachedDevice(device) {
    const cacheKey = device?.cacheKey;
    if (!cacheKey) return;
    const res = await fetch(`/api/intiface/cache/profile?key=${encodeURIComponent(cacheKey)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const data = await res.json();
    state.cache = data.cache || { profiles: {} };
    delete state.cache.profiles?.[cacheKey];
    localStorage.setItem("osr.intiface.cache", JSON.stringify(state.cache));
    updateCacheStatus();
    renderDevices();
    log("Forgot cached Intiface profile", { displayName: deviceDisplayLabel(device), model: deviceModelName(device) });
  }

  async function saveMappings() {
    const devices = Array.from(state.devices.values());
    const profiles = {};
    for (const device of devices) {
      applyAutoAssignment(device, { preserveManual: true });
      const mapping = mappingForDevice(device.DeviceIndex);
      profiles[device.cacheKey] = makeCachedProfile(device, mapping);
    }
    const payload = {
      mappings: state.mappings,
      cache: { profiles },
      devices: devices.map(device => ({
        DeviceIndex: device.DeviceIndex,
        DeviceName: device.DeviceName,
        DeviceDisplayName: device.DeviceDisplayName || "",
        cacheKey: device.cacheKey,
        features: device.features
      }))
    };
    state.cache = { profiles: { ...(state.cache?.profiles || {}), ...profiles } };
    localStorage.setItem("osr.intiface.mappings", JSON.stringify(state.mappings));
    localStorage.setItem("osr.intiface.cache", JSON.stringify(state.cache));
    updateCacheStatus();
    try {
      const res = await fetch("/api/intiface/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = await res.json();
      state.mappings = data.intiface?.mappings || state.mappings;
      state.cache = data.cache || data.intiface?.cache || state.cache;
      if (els.mappingStatus) els.mappingStatus.textContent = "Saved to session + cache file";
      updateCacheStatus();
      renderDevices();
      log("Saved Intiface mapping to session and cache", data.intiface);
    } catch (err) {
      if (els.mappingStatus) els.mappingStatus.textContent = "Saved locally only";
      updateCacheStatus();
      log("Could not save mapping to server; kept localStorage copy", err.message, "warn");
    }
  }

  async function loadSetupState() {
    try {
      const res = await fetch("/api/intiface/state", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = await res.json();
      state.config = { ...DEFAULTS, ...(data.config || {}) };
      state.players = Array.isArray(data.players) ? data.players : [];
      state.mappings = data.intiface?.mappings || {};
      state.cache = data.cache || data.intiface?.cache || { profiles: {} };
      if (data.runtime) applyRuntimeSnapshot(data.runtime);
      localStorage.setItem("osr.intiface.cache", JSON.stringify(state.cache));
      if (els.mappingStatus) els.mappingStatus.textContent = data.intiface?.updatedAt ? "Loaded from session/cache" : "No saved mapping";
      updateCacheStatus();
    } catch (err) {
      log("Could not load server Intiface setup state", err.message, "warn");
      try { state.mappings = JSON.parse(localStorage.getItem("osr.intiface.mappings") || "{}"); } catch { state.mappings = {}; }
      try { state.cache = JSON.parse(localStorage.getItem("osr.intiface.cache") || "{\"profiles\":{}}"); } catch { state.cache = { profiles: {} }; }
      updateCacheStatus();
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  async function init() {
    try {
      const res = await fetch("/api/intiface/templates", { cache: "no-store" });
      if (res.ok) { const data = await res.json(); if (Array.isArray(data.templates) && data.templates.length) TEMPLATES = data.templates; }
    } catch (err) { log("Using built-in Intiface templates", err.message, "warn"); }
    if (IS_SETUP) await loadSetupState();
    else {
      try {
        const res = await fetch("/api/intiface/state", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          state.config = { ...DEFAULTS, ...(data.config || {}) };
          state.cache = data.cache || data.intiface?.cache || state.cache;
          updateCacheStatus();
        }
      } catch (err) { log("Using default Intiface diagnostics config", err.message, "warn"); }
    }
    renderPlayers();
    renderTemplates();
    renderDevices();
    renderButtons();
    renderLiveMonitor();

    els.scanBtn?.addEventListener("click", () => refreshDevices().catch(err => log("Refresh failed", err.message, "error")));
    els.stopAllBtn?.addEventListener("click", () => stopAll().catch(err => log("Stop all failed", err.message, "error")));
    els.sendRawBtn?.addEventListener("click", () => {
      try { sendMessages(JSON.parse(els.rawCommand.value)); }
      catch (err) { log("Raw command failed", err.message, "error"); }
    });
    els.copyLogBtn?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(state.logLines.join("\n")).catch(err => log("Copy failed", err.message, "error"));
    });
    els.clearLogBtn?.addEventListener("click", () => { state.logLines = []; if (els.logOutput) els.logOutput.textContent = ""; });
    els.templateSelect?.addEventListener("change", () => { updateTemplateDescription(); renderDevices(); });
    els.templatePower?.addEventListener("input", renderTemplateFlowGraph);
    els.deviceList?.addEventListener("pointerdown", () => { state.deviceListInteractionUntil = Date.now() + 5000; }, true);
    els.deviceList?.addEventListener("focusin", () => { state.deviceListInteractionUntil = Date.now() + 5000; });
    els.deviceList?.addEventListener("change", () => { state.deviceListInteractionUntil = Date.now() + 1500; }, true);
    els.saveMappingsBtn?.addEventListener("click", () => saveMappings().catch(err => log("Save failed", err.message, "error")));
    els.exportCacheBtn?.addEventListener("click", () => exportCache().catch(err => log("Export cache failed", err.message, "error")));
    els.importCacheBtn?.addEventListener("click", () => els.importCacheFile?.click());
    els.importCacheFile?.addEventListener("change", () => importCacheFromFile(els.importCacheFile.files?.[0]).catch(err => log("Import cache failed", err.message, "error")));
    els.resetCacheBtn?.addEventListener("click", () => resetCache().catch(err => log("Reset cache failed", err.message, "error")));
    els.previewSelectedBtn?.addEventListener("click", () => {
      const device = state.devices.get(Number(state.selectedDeviceIndex));
      previewTemplate(device ? [device] : []).catch(err => log("Preview failed", err.message, "error"));
    });
    els.previewAllBtn?.addEventListener("click", () => previewTemplate(Array.from(state.devices.values()).filter(device => profileSettingsForDevice(device.DeviceIndex).enabled)).catch(err => log("Preview all failed", err.message, "error")));
    els.stopPreviewBtn?.addEventListener("click", () => stopPreview().catch(err => log("Stop preview failed", err.message, "error")));
    startHeartbeat();
    log("Intiface setup page ready; using the OSR server-owned connection");
  }

  init().catch(err => log("Startup failed", err.message, "error"));
})();
