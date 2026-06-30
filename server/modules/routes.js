
var server = http.createServer(async (req, res) => {
  const requestStartedAt = Date.now();
  let urlForLogging = null;
  res.on("finish", () => {
    try {
      const durationMs = Date.now() - requestStartedAt;
      debugState.counters.incomingTotal += 1;
      if (res.statusCode >= 400) debugState.counters.incomingErrors += 1;
      const entry = {
        time: new Date().toISOString(),
        ip: req.socket?.remoteAddress || "unknown",
        method: req.method,
        path: safeRequestPath(req, urlForLogging),
        statusCode: res.statusCode,
        responseTimeMs: durationMs,
        userAgent: req.headers["user-agent"] || ""
      };
      logIncomingRequest(entry);
      const dbg = debugConfig();
      if (durationMs >= dbg.slowRequestThresholdMs) {
        debugState.counters.slowRequests += 1;
        logSlowRequest({ ...entry, thresholdMs: dbg.slowRequestThresholdMs });
      }
    } catch (err) {
      console.warn(`Could not record request debug log: ${err.message}`);
    }
  });

  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    urlForLogging = url;

    const publicPaths = ["/player", "/player/index.html", "/player/player.js", "/player/player.css", "/player.js", "/player.css", "/host", "/host/index.html", "/host/host.js", "/host/host.css", "/host.js", "/host.css", "/audience", "/audience/index.html", "/audience/audience.js", "/audience/audience.css", "/audience.js", "/audience.css", "/api/player-pages/config"];
    const isPlayerApi = /^\/api\/player\/[^/]+\/(state|action)$/.test(url.pathname);
    const isHostApi = /^\/api\/host\/(state|action|control|audience-vote|objective-events\/ack|spinner|reward|force-player)$/.test(url.pathname);
    const isAudienceApi = /^\/api\/audience\/(state|action|session)$/.test(url.pathname);
    const isPublicPlayerPath = publicPaths.includes(url.pathname) || url.pathname.startsWith("/player/") || isPlayerApi || isHostApi || isAudienceApi;
    if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req) && !isPublicPlayerPath) {
      return sendJson(res, 403, { error: "Admin page/API is available from localhost only. Use /player/<id>?key=<id> for player pages." });
    }

    if (url.pathname === "/diagnostics" || url.pathname === "/debug") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendDiagnosticsHtml(res, APP_ROOT);
    }

    if (url.pathname === "/api/debug/stats" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, getDebugSnapshot());
    }

    if (url.pathname === "/api/diagnostics/state" && req.method === "GET") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      const forceRefresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
      return sendJson(res, 200, await buildDiagnosticsState({ forceRefresh }));
    }

    if (url.pathname === "/api/diagnostics/export" && req.method === "GET") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      const data = redactDiagnosticsExport(await buildDiagnosticsState({ forceRefresh: false }));
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="osr-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json"`
      });
      return res.end(JSON.stringify(data, null, 2));
    }

    if (url.pathname === "/api/diagnostics/reload-shockers" && req.method === "POST") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      return await handleDiagnosticsReloadShockers(req, res);
    }

    if (url.pathname === "/api/diagnostics/test" && req.method === "POST") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      return await handleDiagnosticsTest(req, res);
    }

    if (url.pathname === "/api/diagnostics/stop-all" && req.method === "POST") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      return await handleDiagnosticsStopAll(req, res);
    }

    if (url.pathname === "/api/diagnostics/simulate" && req.method === "POST") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      return await handleDiagnosticsSimulate(req, res);
    }

    if (url.pathname === "/api/diagnostics/preflight" && req.method === "GET") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      return await handleDiagnosticsPreflight(req, res);
    }

    if (url.pathname === "/api/diagnostics/api-key-check" && req.method === "POST") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      return await handleDiagnosticsApiKeyCheck(req, res);
    }

    if (url.pathname === "/api/diagnostics/clear-debug" && req.method === "POST") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      return handleDiagnosticsClearDebug(req, res);
    }

    if (url.pathname === "/api/diagnostics/clear-shocker-cache" && req.method === "POST") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      clearShockerCache();
      return sendJson(res, 200, { cleared: true });
    }

    if (url.pathname === "/api/diagnostics/archive-reset-session" && req.method === "POST") {
      if (!diagnosticsAccessAllowed(req, url)) return sendJson(res, 403, { error: "Diagnostics require localhost access" });
      const result = resetSessionState();
      return sendJson(res, 200, { reset: true, session: result.session, archivedTo: result.archivedTo });
    }

    if (url.pathname === "/api/debug/cache" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, getDebugSnapshot().cache);
    }

    if (url.pathname === "/api/debug/requests" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, { incomingRequests: debugState.incomingRequests.slice().reverse(), slowRequests: debugState.slowRequests.slice().reverse() });
    }

    if (url.pathname === "/api/debug/openshock" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, { openShockCalls: debugState.openShockCalls.slice().reverse(), counters: getDebugSnapshot().counters, cache: getDebugSnapshot().cache });
    }

    if (url.pathname === "/api/debug/clear" && req.method === "POST") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      debugState.incomingRequests.length = 0;
      debugState.slowRequests.length = 0;
      debugState.openShockCalls.length = 0;
      debugState.openShockDurations.length = 0;
      for (const key of Object.keys(debugState.counters)) debugState.counters[key] = 0;
      return sendJson(res, 200, { cleared: true });
    }

    if (serveRoleStaticFile(req, res, url, { appRoot: APP_ROOT, sendJson })) return;

    if (url.pathname === "/player" && req.method === "GET") {
      if (!playerPagesConfig().enabled) return sendJson(res, 403, { error: "Player pages are disabled" });
      return serveHtmlFile(res, path.join(APP_ROOT, "player", "index.html"));
    }

    if (url.pathname.startsWith("/player/") && req.method === "GET" && !path.extname(url.pathname)) {
      if (!playerPagesConfig().enabled) return sendJson(res, 403, { error: "Player pages are disabled" });
      return serveHtmlFile(res, path.join(APP_ROOT, "player", "index.html"));
    }

    if (url.pathname === "/host" && req.method === "GET") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return serveHtmlFile(res, path.join(APP_ROOT, "host", "index.html"));
    }

    if (url.pathname === "/audience" && req.method === "GET") {
      if (!audiencePageConfig().enabled) return sendJson(res, 403, { error: "Audience page is disabled" });
      return serveHtmlFile(res, path.join(APP_ROOT, "audience", "index.html"));
    }

    if (url.pathname === "/api/player-pages/config" && req.method === "GET") {
      return sendJson(res, 200, { ...playerPagesConfig(), publicBaseUrl: getPublicBaseUrl(req) });
    }

    if (url.pathname === "/api/player-links" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, await buildPlayerLinks(req));
    }

    if (url.pathname === "/api/role-links" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, await buildRoleLinks(req));
    }

    if (url.pathname === "/api/host/state" && req.method === "GET") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      return sendJson(res, 200, await getHostState());
    }

    if (url.pathname === "/api/host/action" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return await resolveHostAction(req, res, url);
    }

    if (url.pathname === "/api/host/audience-vote" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return await resolveAudienceVote(req, res, url);
    }

    if (url.pathname === "/api/host/objective-events/ack" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return await acknowledgeObjectiveEvents(req, res, url);
    }

    if (url.pathname === "/api/host/reward" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      return await rewardPlayerFromHost(req, res, url);
    }

    if (url.pathname === "/api/host/force-player" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      const targetPlayerId = String(body.targetPlayerId || "");
      if (!targetPlayerId) return sendJson(res, 400, { error: "Pick a target player" });
      const state = readSessionState();
      const modifier = queueRoundModifier(state, { type: "guaranteedPickNextRound", source: "host", targetPlayerId, tokenType: "guarantee" });
      writeSessionState(state);
      return sendJson(res, 200, { ok: true, modifier });
    }

    if (url.pathname === "/api/host/spinner" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      const command = String(body.command || "");
      if (!["spin", "pause", "resume", "forceEventNextRound"].includes(command)) return sendJson(res, 400, { error: "Unsupported spinner command" });
      const state = readSessionState();
      if (command === "forceEventNextRound") {
        const eventCardId = String(body.eventCardId || "").trim();
        if (eventCardId) {
          const card = (readEventCards().cards || []).find(c => c && c.enabled !== false && String(c.id) === eventCardId);
          if (!card) return sendJson(res, 400, { error: "Unknown or disabled event card" });
        }
        const modifier = queueRoundModifier(state, {
          type: "forceEventNextRound",
          source: "host",
          eventCardId: eventCardId || null,
          reason: eventCardId ? `Host forced event card ${eventCardId}` : "Host forced random event card"
        });
        writeSessionState(state);
        return sendJson(res, 200, { ok: true, modifier });
      }
      state.hostCommands = Array.isArray(state.hostCommands) ? state.hostCommands : [];
      if (command === "pause") state.hostPaused = true;
      if (command === "resume" || command === "spin") state.hostPaused = false;
      const item = { id: uuid("cmd"), command, createdAt: new Date().toISOString(), status: "pending" };
      state.hostCommands.push(item);
      writeSessionState(state);
      return sendJson(res, 200, { ok: true, command: item });
    }

    if (url.pathname === "/api/host/spinner-commands" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      const state = readSessionState();
      const pending = (state.hostCommands || []).filter(c => c.status === "pending");
      state.hostCommands = (state.hostCommands || []).map(c => c.status === "pending" ? { ...c, status: "consumed", consumedAt: new Date().toISOString() } : c).slice(-50);
      writeSessionState(state);
      return sendJson(res, 200, { commands: pending });
    }

    if (url.pathname === "/api/host/control" && req.method === "POST") {
      if (!hostPageConfig().enabled) return sendJson(res, 403, { error: "Host page is disabled" });
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      return await handleControl(req, res);
    }

    if (url.pathname === "/api/audience/session" && (req.method === "GET" || req.method === "POST")) {
      if (!audiencePageConfig().enabled) return sendJson(res, 403, { error: "Audience page is disabled" });
      return await createOrReadAudienceSession(req, res, url);
    }

    if (url.pathname === "/api/audience/state" && req.method === "GET") {
      if (!audiencePageConfig().enabled) return sendJson(res, 403, { error: "Audience page is disabled" });
      if (!validateAudienceAccess(req, url)) return sendJson(res, 403, { error: "Audience page is disabled" });
      const state = readSessionState();
      const audienceSessionId = getAudienceSessionId(req, url);
      const displayName = sanitizeAudienceName(url.searchParams.get("displayName") || "");
      const session = audiencePageConfig().requireUniqueSession ? ensureAudienceSession(state, audienceSessionId) : { id: audienceSessionId || "shared", displayName: displayName || "Audience" };
      if (audiencePageConfig().requireUniqueSession && !session) return sendJson(res, 401, { error: "Audience session expired. Enter your name again." });
      updateAudienceSessionName(state, session, displayName);
      session.lastSeenAt = new Date().toISOString();
      writeSessionState(state);
      const players = await publicPlayers();
      return sendJson(res, 200, { roundNumber: state.roundNumber, players, economy: economyConfig(), audiencePage: audiencePageConfig(), audienceSession: session, audienceVoteThresholdEffective: effectiveAudienceVoteThreshold(state), audienceSessions: state.audienceSessions || {}, audienceVotes: (state.audienceVotes || []).map(v => voteView(v, players, state)), audienceEventLog: state.audienceEventLog || [] });
    }

    if (url.pathname === "/api/audience/action" && req.method === "POST") {
      if (!audiencePageConfig().enabled) return sendJson(res, 403, { error: "Audience page is disabled" });
      return await handleAudienceAction(req, res, url);
    }

    if (url.pathname === "/api/objectives" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      return sendJson(res, 200, { definitions: readObjectives(), session: readSessionState() });
    }

    if (url.pathname === "/api/objectives/generate" && req.method === "POST") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      const body = await readBody(req);
      const session = await assignObjectivesToPlayers({ resetExisting: Boolean(body.resetExisting ?? true) });
      return sendJson(res, 200, { generated: true, session });
    }

    const playerStateMatch = url.pathname.match(/^\/api\/player\/([^/]+)\/state$/);
    if (playerStateMatch && req.method === "GET") {
      if (!requirePlayerPagesEnabled(req, res)) return;
      const playerId = decodeURIComponent(playerStateMatch[1]);
      if (!validatePlayerAccess(req, playerId, url)) return sendJson(res, 403, { error: "Invalid player key" });
      const { shockers } = await getShockers();
      const players = buildLogicalPlayersFromShockers(shockers);
      const player = findLogicalPlayerById(players, playerId) || shockers.find(s => String(s.id) === String(playerId)) || { id: playerId, name: "Unknown player", devices: [] };
      const sessionState = readSessionState();
      const pendingActions = (sessionState.pendingPlayerActions || [])
        .filter(a => a.status === "pending")
        .filter(a => a.playerId === playerId || a.bodyguardPlayerId === playerId)
        .map(a => pendingActionView(a, shockers));
      const activeBodyguards = (sessionState.pendingRoundModifiers || [])
        .filter(m => m.status !== "consumed" && m.type === "bodyguardNextRound")
        .filter(m => String(m.bodyguardPlayerId) === String(playerId) || String(m.targetPlayerId) === String(playerId))
        .map(m => modifierView(m, shockers));
      return sendJson(res, 200, { player, players, ...getPlayerState(playerId), playerPages: playerPagesConfig(), economy: economyConfig(), pendingActions, activeBodyguards });
    }

    const playerActionMatch = url.pathname.match(/^\/api\/player\/([^/]+)\/action$/);
    if (playerActionMatch && req.method === "POST") {
      if (!requirePlayerPagesEnabled(req, res)) return;
      const playerId = decodeURIComponent(playerActionMatch[1]);
      return await handlePlayerAction(req, res, playerId, url);
    }

    if (url.pathname === "/api/config" && req.method === "GET") {
      CONFIG = readConfig();
      return sendJson(res, 200, CONFIG);
    }

    if (url.pathname === "/api/config" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const incoming = await readBody(req);
      const validated = validateConfig(incoming);
      writeConfig(validated);
      CONFIG = validated;
      clearShockerCache();
      return sendJson(res, 200, { saved: true, config: CONFIG });
    }

    if (url.pathname === "/api/config/reset" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      CONFIG = resetGameConfigToDefaults();
      return sendJson(res, 200, { saved: true, reset: true, config: CONFIG });
    }

    if (url.pathname === "/api/event-cards" && req.method === "GET") {
      return sendJson(res, 200, readEventCards());
    }

    if (url.pathname === "/api/round-modifiers/consume" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      return sendJson(res, 200, { consumed: true, pendingRoundModifiers: consumeRoundModifiers(body.ids || []) });
    }

    if (url.pathname === "/api/database/summary" && req.method === "GET") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      const db = getDatabase();
      const tables = ["state", "meta", "app_log"];
      const counts = {};
      for (const table of tables) {
        try { counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count; } catch { counts[table] = null; }
      }
      return sendJson(res, 200, { schemaVersion: getMeta("schemaVersion"), appVersion: getMeta("appVersion"), storageMode: getMeta("storageMode"), currentGameId: getCurrentGameId(), counts });
    }

    if (url.pathname === "/api/event-log" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      writeDatabaseEvent(body || {});
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/round-result" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const body = await readBody(req);
      writeRoundResult(body || {});
      const state = readSessionState();
      processRolePassivesForRoundResult(state, body || {});
      writeSessionState(state);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/session" && req.method === "GET") {
      return sendJson(res, 200, readSessionState());
    }

    if (url.pathname === "/api/session" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const incoming = await readBody(req);
      const current = readSessionState();
      incoming.playerStats = mergePlayerStatsForSessionSave(incoming.playerStats, current.playerStats);
      incoming.objectiveAssignments = current.objectiveAssignments || {};
      incoming.playerPoints = current.playerPoints || {};
      incoming.playerTokens = current.playerTokens || {};
      incoming.playerMultipliers = incoming.playerMultipliers && typeof incoming.playerMultipliers === "object" ? incoming.playerMultipliers : (current.playerMultipliers || {});
      incoming.pendingRoundModifiers = current.pendingRoundModifiers || [];
      incoming.pendingPlayerActions = current.pendingPlayerActions || [];
      incoming.hiddenRoles = current.hiddenRoles || {};
      incoming.rolePassiveState = current.rolePassiveState || {};
      incoming.completedObjectiveEvents = current.completedObjectiveEvents || [];
      incoming.audienceVotes = current.audienceVotes || [];
      incoming.audienceSessions = current.audienceSessions || {};
      incoming.audienceEventLog = current.audienceEventLog || [];
      incoming.hostCommands = current.hostCommands || [];
      incoming.hostPaused = current.hostPaused || false;
      incoming.roleAccessKeys = current.roleAccessKeys || {};
      return sendJson(res, 200, { saved: true, session: writeSessionState(incoming) });
    }

    if (url.pathname === "/api/player-multipliers" && req.method === "POST") {
      if (CONFIG.server?.adminLocalhostOnly !== false && !isLocalRequest(req)) return sendJson(res, 403, { error: "Admin endpoint is localhost only" });
      const body = await readBody(req);
      const state = readSessionState();
      state.playerMultipliers = state.playerMultipliers && typeof state.playerMultipliers === "object" ? state.playerMultipliers : {};
      const updates = body.playerMultipliers && typeof body.playerMultipliers === "object" ? body.playerMultipliers : {};
      for (const [playerId, raw] of Object.entries(updates)) {
        const id = String(playerId || "");
        if (!id) continue;
        const value = clampInt(raw ?? 100, 0, 100);
        state.playerMultipliers[id] = value;
        updatePlayerMultiplierInDatabase(id, value);
      }
      writeSessionState(state);
      const saved = readSessionState().playerMultipliers || state.playerMultipliers;
      return sendJson(res, 200, { ok: true, playerMultipliers: saved });
    }

    if (url.pathname === "/api/session/reset" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      const result = resetSessionState();
      return sendJson(res, 200, { reset: true, session: result.session, archivedTo: result.archivedTo });
    }

    if (url.pathname === "/api/shockers" && req.method === "GET") {
      const forceRefresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
      return sendJson(res, 200, await getShockers({ forceRefresh }));
    }

    if (url.pathname === "/api/control" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      return await handleControl(req, res);
    }

    if (url.pathname === "/api/stop-all" && req.method === "POST") {
      if (!validateRoleAccess("host", req, url) && !isLocalRequest(req)) return sendJson(res, 403, { error: "Invalid host key" });
      return await handleStopAll(req, res);
    }

    return serveStaticFile(req, res, url, { appRoot: APP_ROOT, sendJson });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, process.env.HOST || CONFIG.server?.host || "0.0.0.0", () => {
  console.log(`${CONFIG.app?.serverBanner || CONFIG.app?.displayTitle || 'OpenShock Roulette'} running at http://localhost:${PORT}`);
  getLanAddresses().forEach(ip => console.log(`Player pages available at http://${ip}:${PORT}/player`));
  console.log(`Config source: ${CONFIG_PATH}; defaults: ${CONFIG_EXAMPLE_PATH}`);
  console.log(`SQLite JSON blob state DB: ${DB_PATH}`);
  if (!TOKEN) console.log("WARNING: OPENSHOCK_TOKEN / OPENSHOCK_API_TOKEN is not set.");
});
