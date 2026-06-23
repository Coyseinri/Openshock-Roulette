// OpenShock Roulette server application loader
// Server implementation is split into server/modules/*.js and loaded in order.

var fs = require("fs");
var path = require("path");

var SERVER_MODULE_DIR = path.join(__dirname, "modules");
var SERVER_MODULES = [
  "runtime.js",
  "database-session.js",
  "server-context.js",
  "objectives-roles.js",
  "access-pages.js",
  "economy-host-state.js",
  "actions-modifiers.js",
  "config.js",
  "openshock.js",
  "validation.js",
  "routes.js"
];

for (var i = 0; i < SERVER_MODULES.length; i += 1) {
  var moduleName = SERVER_MODULES[i];
  var modulePath = path.join(SERVER_MODULE_DIR, moduleName);
  var moduleSource = fs.readFileSync(modulePath, "utf8") + "\n//# sourceURL=" + modulePath.replace(/\\/g, "/");
  eval(moduleSource);
}
