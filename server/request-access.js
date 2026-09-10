// Participant URLs are explicit; API handlers still enforce their role keys.
const ROLE_ASSETS = new Set([
  '/player', '/player/', '/player/index.html', '/player/player.js', '/player/player.css',
  '/host', '/host/', '/host/index.html', '/host/host.js', '/host/host.css', '/host/shared.css',
  '/audience', '/audience/', '/audience/index.html', '/audience/audience.js', '/audience/audience.css', '/audience/shared.css'
]);

function participantPath(pathname) {
  return ROLE_ASSETS.has(pathname)
    || /^\/player\/[^/.]+$/.test(pathname)
    || pathname === '/api/player-pages/config'
    || /^\/api\/player\/[^/]+\/(state|action)$/.test(pathname)
    || /^\/api\/host\/(state|action|control|stop-all|audience-vote|objective-events\/ack|spinner|reward|force-player)$/.test(pathname)
    || /^\/api\/audience\/(state|action|session)$/.test(pathname);
}

function requestAccessError(req, url, local) {
  const rawPath = String(req.url || '').split('?')[0];
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return { status: 400, error: 'Invalid URL encoding' }; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '.' || part === '..')) {
    return { status: 403, error: 'Forbidden path' };
  }
  if (!local && !participantPath(url.pathname)) return { status: 403, error: 'This page/API is available from localhost only' };
  if (url.pathname.startsWith('/api/')) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return { status: 403, error: 'Cross-site API requests are not allowed' };
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw new Error('origin');
      } catch { return { status: 403, error: 'Untrusted request origin' }; }
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const hasBody = Number(req.headers['content-length'] || 0) > 0 || Boolean(req.headers['transfer-encoding']);
      if ((hasBody || type) && type !== 'application/json') return { status: 415, error: 'Use application/json' };
    }
  }
  return null;
}

module.exports = { participantPath, requestAccessError };
