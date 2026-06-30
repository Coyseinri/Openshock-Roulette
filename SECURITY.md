# Security Policy

## API tokens

Never commit your OpenShock API token.

Use an environment variable:

```powershell
$env:OPENSHOCK_TOKEN = "paste-your-token-here"
```

The browser never receives the token. `server.js` acts as a local proxy and sends the token only from the local Node.js process.

The diagnostics page can test whether the configured token can read shockers and, when explicitly confirmed, send a STOP command to verify control permission. It does not expose the raw token to the browser.

## Diagnostics page

The diagnostics page is intended for localhost/admin use only.

Default local URL:

```text
http://localhost:8787/diagnostics
```

Diagnostics exports redact obvious sensitive values by default, including token-like and key-like fields.

Still review exported diagnostics before sharing them publicly. Redaction helps, but exports may still include private operational details such as local paths, device IDs, player names, browser details, config structure, or other context you may not want in a public GitHub issue.

## Files intentionally ignored

The following files are ignored by Git:

```text
.env
config/config.json
config/shockers.json
config/event-cards.json
config/objectives.json
data/
logs/
*.log
node_modules/
```

Use:

```text
.env.example
config/config.example.json
config/shockers.example.json
config/event-cards.example.json
config/objectives.example.json
```

as templates.

## Reporting issues

If you find a security issue, do not post real tokens, real shocker IDs, private OpenShock account data, diagnostics exports, or private player/session data in public GitHub issues.

If a diagnostics export is useful for troubleshooting, review it first and remove anything you would not want strangers, gremlins, or Future You to see.
