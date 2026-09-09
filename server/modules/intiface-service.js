var INTIFACE_STATES = Object.freeze({
  DISABLED: "disabled", DISCONNECTED: "disconnected", CONNECTING: "connecting", CONNECTED: "connected",
  READY: "ready", RECONNECTING: "reconnecting", SUSPENDED: "suspended", FAILED: "failed"
});

function intifaceRuntimeConfig() {
  CONFIG = readConfig();
  const root = CONFIG.intiface || {};
  const reconnect = root.reconnect || {};
  const enabled = root.enabled === true;
  return {
    enabled,
    autoConnect: enabled && root.autoConnect !== false,
    websocketUrl: String(root.websocketUrl || "ws://127.0.0.1:12345"),
    healthCheckIntervalMs: clampInt(root.healthCheckIntervalMs ?? 15000, 3000, 300000),
    healthCheckTimeoutMs: clampInt(root.healthCheckTimeoutMs ?? 5000, 1000, 30000),
    commandTimeoutMs: clampInt(root.commandTimeoutMs ?? 5000, 500, 30000),
    deviceKeepAwake: {
      enabled: root.deviceKeepAwake?.enabled !== false,
      intervalMs: clampInt(root.deviceKeepAwake?.intervalMs ?? 60000, 10000, 3600000),
      commandTimeoutMs: clampInt(root.deviceKeepAwake?.commandTimeoutMs ?? 3000, 500, 30000)
    },
    reconnect: {
      enabled: reconnect.enabled !== false,
      maxAttempts: clampInt(reconnect.maxAttempts ?? 5, 0, 50),
      initialDelayMs: clampInt(reconnect.initialDelayMs ?? 1000, 100, 60000),
      maxDelayMs: clampInt(reconnect.maxDelayMs ?? 30000, 1000, 300000),
      backoffMultiplier: Math.max(1, Math.min(10, Number(reconnect.backoffMultiplier ?? 2) || 2))
    }
  };
}

function createIntifaceService() {
  const service = {
    state: INTIFACE_STATES.DISCONNECTED,
    ws: null,
    nextId: 1,
    pending: new Map(),
    devices: new Map(),
    serverInfo: null,
    healthTimer: null,
    keepAwakeTimer: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    lastSuccessfulResponseAt: null,
    lastHealthCheckAt: null,
    lastHealthLatencyMs: null,
    lastError: null,
    lastCommandAt: null,
    lastKeepAwakeAt: null,
    activeDeviceIndexes: new Set(),
    started: false,
    manualDisconnect: false,
    connectingPromise: null,

    config() { return intifaceRuntimeConfig(); },
    isOpen() { return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN); },
    isReady() { return this.state === INTIFACE_STATES.READY && this.isOpen(); },

    log(message, extra = null) {
      const suffix = extra ? ` ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : "";
      console.log(`[Intiface] ${message}${suffix}`);
    },

    snapshot() {
      const cfg = this.config();
      return {
        enabled: cfg.enabled,
        autoConnect: cfg.autoConnect,
        websocketUrl: cfg.websocketUrl,
        state: this.state,
        websocketConnected: this.isOpen(),
        ready: this.isReady(),
        serverInfo: this.serverInfo,
        devices: Array.from(this.devices.values()),
        connectedDeviceCount: this.devices.size,
        lastSuccessfulResponseAt: this.lastSuccessfulResponseAt,
        lastHealthCheckAt: this.lastHealthCheckAt,
        lastHealthLatencyMs: this.lastHealthLatencyMs,
        reconnectAttempts: this.reconnectAttempts,
        automaticReconnectSuspended: this.state === INTIFACE_STATES.SUSPENDED,
        pendingRequestCount: this.pending.size,
        lastError: this.lastError,
        deviceKeepAwake: {
          enabled: cfg.deviceKeepAwake.enabled,
          intervalMs: cfg.deviceKeepAwake.intervalMs,
          lastRunAt: this.lastKeepAwakeAt,
          activeDeviceCount: this.activeDeviceIndexes.size
        }
      };
    },

    async start() {
      if (this.started) return;
      this.started = true;
      const cfg = this.config();
      if (!cfg.enabled) { this.state = INTIFACE_STATES.DISABLED; this.log("Server connection disabled"); return; }
      if (typeof WebSocket !== "function") { this.state = INTIFACE_STATES.FAILED; this.lastError = "Node.js WebSocket API is unavailable"; this.log(this.lastError); return; }
      if (cfg.autoConnect) this.connect({ automatic: true }).catch(() => {});
    },

    clearPending(reason) {
      for (const item of this.pending.values()) { clearTimeout(item.timeout); item.reject(new Error(reason)); }
      this.pending.clear();
    },

    async sendRequest(name, payload = {}, timeoutMs = null) {
      if (!this.isOpen()) throw new Error("Intiface WebSocket is not connected");
      const id = this.nextId++;
      const envelope = [{ [name]: { ...payload, Id: id } }];
      const waitMs = clampInt(timeoutMs ?? this.config().commandTimeoutMs, 500, 30000);
      const promise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${name} timed out`)); }, waitMs);
        this.pending.set(id, { resolve, reject, timeout, name });
      });
      this.ws.send(JSON.stringify(envelope));
      const response = await promise;
      this.recordCommandState(name, payload);
      return response;
    },

    async sendRaw(messages, waitForResponse = true, timeoutMs = null) {
      if (!this.isOpen()) throw new Error("Intiface WebSocket is not connected");
      const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
      if (!list.length) throw new Error("No Buttplug messages supplied");

      if (!waitForResponse) {
        this.ws.send(JSON.stringify(list));
        for (const envelope of list) {
          const name = Object.keys(envelope || {})[0];
          if (name) this.recordCommandState(name, envelope[name] || {});
        }
        return { sent: true, count: list.length };
      }

      const waitMs = clampInt(timeoutMs ?? this.config().commandTimeoutMs, 500, 30000);
      const pendingItems = [];
      const outgoing = list.map(envelope => {
        const name = Object.keys(envelope || {})[0];
        if (!name) throw new Error("Invalid Buttplug message");
        const payload = { ...(envelope[name] || {}) };
        delete payload.Id;
        const id = this.nextId++;
        const message = { [name]: { ...payload, Id: id } };
        const promise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${name} timed out`)); }, waitMs);
          this.pending.set(id, { resolve, reject, timeout, name });
        });
        pendingItems.push({ name, payload, promise });
        return message;
      });

      this.ws.send(JSON.stringify(outgoing));
      const responses = await Promise.all(pendingItems.map(item => item.promise));
      for (const item of pendingItems) this.recordCommandState(item.name, item.payload);
      return responses.length === 1 ? responses[0] : responses;
    },

    recordCommandState(name, payload = {}) {
      const now = new Date().toISOString();
      if (["ScalarCmd", "VibrateCmd", "RotateCmd", "LinearCmd", "StopDeviceCmd", "StopAllDevices"].includes(name)) this.lastCommandAt = now;
      const index = Number(payload.DeviceIndex);
      if (name === "StopAllDevices") this.activeDeviceIndexes.clear();
      if (name === "StopDeviceCmd" && Number.isFinite(index)) this.activeDeviceIndexes.delete(index);
      if (name === "ScalarCmd" && Number.isFinite(index)) {
        const values = Array.isArray(payload.Scalars) ? payload.Scalars.map(item => Number(item?.Scalar || 0)) : [];
        if (values.some(value => value > 0)) this.activeDeviceIndexes.add(index);
        else this.activeDeviceIndexes.delete(index);
      }
      if (["VibrateCmd", "RotateCmd", "LinearCmd"].includes(name) && Number.isFinite(index)) this.activeDeviceIndexes.add(index);
    },

    handleMessage(event) {
      let messages;
      try { messages = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); } catch (err) { this.lastError = `Invalid Intiface JSON: ${err.message}`; return; }
      if (!Array.isArray(messages)) messages = [messages];
      for (const envelope of messages) {
        const name = Object.keys(envelope || {})[0];
        const payload = name ? envelope[name] : null;
        const id = payload?.Id;
        this.lastSuccessfulResponseAt = new Date().toISOString();
        if (id && this.pending.has(id)) {
          const pending = this.pending.get(id); this.pending.delete(id); clearTimeout(pending.timeout);
          if (name === "Error") pending.reject(new Error(payload.ErrorMessage || `Intiface error ${payload.ErrorCode}`));
          else pending.resolve(envelope);
        }
        if (name === "ServerInfo") this.serverInfo = payload;
        if (name === "DeviceList") this.replaceDevices(payload.Devices || []);
        if (name === "DeviceAdded") this.upsertDevice(payload);
        if (name === "DeviceRemoved") this.devices.delete(Number(payload.DeviceIndex));
        if (name === "Error") this.lastError = payload.ErrorMessage || String(payload.ErrorCode || "Intiface error");
      }
    },

    upsertDevice(device) {
      const index = Number(device?.DeviceIndex);
      if (Number.isFinite(index)) this.devices.set(index, { ...device, DeviceIndex: index });
    },
    replaceDevices(devices) { this.devices.clear(); for (const device of devices) this.upsertDevice(device); },

    async connect({ automatic = false } = {}) {
      if (this.connectingPromise) return this.connectingPromise;
      if (this.isReady()) return this.snapshot();
      const cfg = this.config();
      if (!cfg.enabled) { this.state = INTIFACE_STATES.DISABLED; return this.snapshot(); }
      this.manualDisconnect = false;
      this.state = automatic && this.reconnectAttempts > 0 ? INTIFACE_STATES.RECONNECTING : INTIFACE_STATES.CONNECTING;
      this.connectingPromise = new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(cfg.websocketUrl);
        this.ws = ws;
        const fail = err => {
          if (settled) return; settled = true;
          this.lastError = err?.message || String(err || "Connection failed");
          this.connectingPromise = null;
          try { ws.close(); } catch {}
          reject(err instanceof Error ? err : new Error(this.lastError));
        };
        const openTimeout = setTimeout(() => fail(new Error("Intiface connection timed out")), cfg.commandTimeoutMs);
        ws.addEventListener("open", async () => {
          clearTimeout(openTimeout);
          this.state = INTIFACE_STATES.CONNECTED;
          try {
            await this.sendRequest("RequestServerInfo", { ClientName: "OpenShock Roulette Server", MessageVersion: 3 }, cfg.commandTimeoutMs);
            await this.sendRequest("RequestDeviceList", {}, cfg.commandTimeoutMs);
            settled = true; this.connectingPromise = null; this.state = INTIFACE_STATES.READY; this.reconnectAttempts = 0; this.lastError = null;
            this.startHealthMonitor(); this.startKeepAwakeMonitor(); this.log(`Connected to ${cfg.websocketUrl}; ${this.devices.size} device(s)`); resolve(this.snapshot());
          } catch (err) { fail(err); }
        });
        ws.addEventListener("message", event => this.handleMessage(event));
        ws.addEventListener("error", () => { if (!settled) fail(new Error("Intiface WebSocket error")); });
        ws.addEventListener("close", () => {
          clearTimeout(openTimeout); this.clearPending("Intiface connection closed"); this.stopHealthMonitor(); this.stopKeepAwakeMonitor(); this.activeDeviceIndexes.clear(); this.devices.clear(); this.ws = null; this.connectingPromise = null;
          if (!this.manualDisconnect) this.scheduleReconnect("WebSocket closed"); else this.state = INTIFACE_STATES.DISCONNECTED;
        });
      });
      try { return await this.connectingPromise; } catch (err) { if (automatic) this.scheduleReconnect(err.message); else this.state = INTIFACE_STATES.SUSPENDED; throw err; }
    },

    startHealthMonitor() {
      this.stopHealthMonitor();
      this.healthTimer = setInterval(async () => {
        if (!this.isReady() || this.pending.size > 0) return;
        const started = Date.now(); this.lastHealthCheckAt = new Date().toISOString();
        try {
          await this.sendRequest("RequestDeviceList", {}, this.config().healthCheckTimeoutMs);
          this.lastHealthLatencyMs = Date.now() - started; this.lastError = null;
        } catch (err) {
          this.lastError = err.message; this.log("Health check failed", err.message); this.closeSocket();
        }
      }, this.config().healthCheckIntervalMs);
    },
    stopHealthMonitor() { if (this.healthTimer) clearInterval(this.healthTimer); this.healthTimer = null; },

    startKeepAwakeMonitor() {
      this.stopKeepAwakeMonitor();
      const cfg = this.config().deviceKeepAwake;
      if (!cfg.enabled) return;
      this.keepAwakeTimer = setInterval(async () => {
        if (!this.isReady() || this.pending.size > 0) return;
        const idleDevices = Array.from(this.devices.keys()).filter(index => !this.activeDeviceIndexes.has(index));
        if (!idleDevices.length) return;
        this.lastKeepAwakeAt = new Date().toISOString();
        for (const deviceIndex of idleDevices) {
          try {
            await this.sendRequest("StopDeviceCmd", { DeviceIndex: deviceIndex }, cfg.commandTimeoutMs);
          } catch (err) {
            this.lastError = `Keep-awake failed for device ${deviceIndex}: ${err.message}`;
            this.log("Device keep-awake failed", this.lastError);
            break;
          }
        }
      }, cfg.intervalMs);
    },
    stopKeepAwakeMonitor() { if (this.keepAwakeTimer) clearInterval(this.keepAwakeTimer); this.keepAwakeTimer = null; },

    closeSocket() { try { if (this.ws) this.ws.close(); } catch {} },

    scheduleReconnect(reason) {
      const cfg = this.config();
      this.lastError = reason || this.lastError;
      if (!cfg.enabled) { this.state = INTIFACE_STATES.DISABLED; return; }
      if (this.manualDisconnect || !cfg.reconnect.enabled) { this.state = INTIFACE_STATES.DISCONNECTED; return; }
      if (this.reconnectTimer) return;
      if (this.reconnectAttempts >= cfg.reconnect.maxAttempts) { this.state = INTIFACE_STATES.SUSPENDED; this.log(`Reconnect suspended after ${this.reconnectAttempts} failed attempt(s)`); return; }
      this.reconnectAttempts += 1; this.state = INTIFACE_STATES.RECONNECTING;
      const delay = Math.min(cfg.reconnect.initialDelayMs * Math.pow(cfg.reconnect.backoffMultiplier, this.reconnectAttempts - 1), cfg.reconnect.maxDelayMs);
      this.log(`Reconnect attempt ${this.reconnectAttempts}/${cfg.reconnect.maxAttempts} in ${delay}ms`, reason);
      this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect({ automatic: true }).catch(() => {}); }, delay);
    },

    async forceReconnect() {
      if (!this.config().enabled) { this.state = INTIFACE_STATES.DISABLED; this.lastError = "Intiface is disabled in config"; return this.snapshot(); }
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; this.reconnectAttempts = 0; this.manualDisconnect = true;
      this.stopHealthMonitor(); this.stopKeepAwakeMonitor(); this.activeDeviceIndexes.clear(); this.clearPending("Manual reconnect"); this.closeSocket(); this.ws = null; this.devices.clear(); this.state = INTIFACE_STATES.DISCONNECTED;
      await new Promise(resolve => setTimeout(resolve, 200));
      this.manualDisconnect = false;
      this.connect({ automatic: false }).catch(err => { this.state = INTIFACE_STATES.SUSPENDED; this.lastError = err.message; });
      return this.snapshot();
    },

    disconnect() {
      this.manualDisconnect = true; if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
      this.stopHealthMonitor(); this.stopKeepAwakeMonitor(); this.activeDeviceIndexes.clear(); this.clearPending("Manual disconnect"); this.closeSocket(); this.ws = null; this.devices.clear(); this.state = INTIFACE_STATES.DISCONNECTED;
      return this.snapshot();
    },

    async scan() {
      if (!this.isReady()) throw new Error("Intiface is not ready");
      try { await this.sendRequest("StartScanning", {}, 3000); } catch (err) { this.lastError = err.message; }
      await this.sendRequest("RequestDeviceList", {}, this.config().commandTimeoutMs);
      return this.snapshot();
    }
  };
  return service;
}

var intifaceService = createIntifaceService();
setTimeout(() => intifaceService.start().catch(err => console.warn(`[Intiface] Startup failed: ${err.message}`)), 0);
