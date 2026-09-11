// Stable identities own generations. Transport indexes never identify queued work.
function createDevicePresence({ now = Date.now, onInvalidate = () => {} } = {}) {
  const entries = new Map();
  const transitions = [];
  let revision = 0;
  const key = (provider, id) => `${provider}:${id}`;
  function update(provider, id, status, reason, transport = null) {
    const k = key(provider, id), old = entries.get(k);
    if (old && old.status === status && old.reason === reason && old.transport === transport) return old;
    const changed = !old || old.status !== status || old.transport !== transport;
    const time = new Date(now()).toISOString();
    const next = {
      provider, id, status, reason, transport,
      generation: changed ? ++revision : old.generation,
      connectedAt: status === 'online' && old?.status !== 'online' ? time : old?.connectedAt || null,
      disconnectedAt: old?.status === 'online' && status !== 'online' ? time : old?.disconnectedAt || null,
      cancelled: Boolean(old && changed), updatedAt: time
    };
    entries.set(k, next);
    if (old && changed) {
      onInvalidate(provider, id);
      // Keep only the latest transition per device within a short debounce window.
      const last = transitions.findLast(item => item.provider === provider && item.id === id);
      if (last && now() - Date.parse(last.at) < 1000) transitions.splice(transitions.indexOf(last), 1);
      transitions.push({ provider, id, status, reason, at: time });
      if (transitions.length > 30) transitions.shift();
    }
    return next;
  }
  function snapshot() { return Object.fromEntries([...entries].map(([k, value]) => [k, value.generation])); }
  function allowed(provider, id, captured = null) {
    const entry = entries.get(key(provider, id));
    return entry?.status === 'online' && (!captured || captured[key(provider, id)] === entry.generation);
  }
  function invalidateProvider(provider, status = 'offline', reason = 'Provider disconnected') {
    for (const entry of entries.values()) if (entry.provider === provider) update(provider, entry.id, status, reason);
  }
  return { entries, transitions, key, update, snapshot, allowed, invalidateProvider };
}

module.exports = { createDevicePresence };
