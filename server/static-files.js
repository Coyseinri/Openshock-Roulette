const fs = require("fs");
const path = require("path");

function contentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".html" ? "text/html; charset=utf-8" :
    ext === ".css" ? "text/css; charset=utf-8" :
    ext === ".js" ? "application/javascript; charset=utf-8" :
    ext === ".json" ? "application/json; charset=utf-8" :
    ext === ".svg" ? "image/svg+xml" :
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    "application/octet-stream";
}

function streamFile(res, filePath, { cacheHeader = null } = {}) {
  const headers = { "Content-Type": contentTypeForPath(filePath) };
  if (cacheHeader) headers["Cache-Control"] = cacheHeader;
  res.writeHead(200, headers);
  return fs.createReadStream(filePath).pipe(res);
}

function sendDiagnosticsHtml(res, appRoot) {
  return streamFile(res, path.join(appRoot, "diagnostics.html"), { cacheHeader: "no-store" });
}

function serveHtmlFile(res, filePath) {
  return streamFile(res, filePath);
}

function roleStaticPath(appRoot, pathname) {
  const files = {
    "/player/index.html": ["player", "index.html"],
    "/player/player.css": ["player", "player.css"],
    "/player/player.js": ["player", "player.js"],
    "/host/index.html": ["host", "index.html"],
    "/host/host.css": ["host", "host.css"],
    "/host/host.js": ["host", "host.js"],
    "/audience/index.html": ["audience", "index.html"],
    "/audience/audience.css": ["audience", "audience.css"],
    "/audience/audience.js": ["audience", "audience.js"]
  };
  const parts = files[pathname];
  return parts ? path.join(appRoot, ...parts) : null;
}

function serveRoleStaticFile(req, res, url, { appRoot, sendJson }) {
  if (req.method !== "GET") return false;
  const assetPath = roleStaticPath(appRoot, url.pathname);
  if (!assetPath) return false;
  if (!fs.existsSync(assetPath)) {
    sendJson(res, 404, { error: "Not found", path: url.pathname });
    return true;
  }
  const ext = path.extname(assetPath).toLowerCase();
  const cacheHeader = ext === ".html" ? "no-store" : "public, max-age=300";
  streamFile(res, assetPath, { cacheHeader });
  return true;
}

function serveStaticFile(req, res, url, { appRoot, sendJson }) {
  const staticAliases = {
    "host.html": path.join("host", "index.html"),
    "host.js": path.join("host", "host.js"),
    "host.css": path.join("host", "host.css"),
    "player.html": path.join("player", "index.html"),
    "player.js": path.join("player", "player.js"),
    "player.css": path.join("player", "player.css"),
    "audience.html": path.join("audience", "index.html"),
    "audience.js": path.join("audience", "audience.js"),
    "audience.css": path.join("audience", "audience.css")
  };

  let requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  requestedPath = staticAliases[requestedPath] || requestedPath;
  const safeRoot = path.resolve(appRoot);
  const filePath = path.resolve(safeRoot, requestedPath);

  if (!filePath.startsWith(safeRoot + path.sep) && filePath !== safeRoot) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(res, 404, { error: "Not found", path: requestedPath });
  }

  return streamFile(res, filePath);
}

module.exports = {
  contentTypeForPath,
  streamFile,
  sendDiagnosticsHtml,
  serveHtmlFile,
  serveRoleStaticFile,
  serveStaticFile
};
