# Security Policy

## API tokens

Never commit your OpenShock API token.

Use an environment variable:

```powershell
$env:OPENSHOCK\_TOKEN = "paste-your-token-here"
```

The browser never receives the token. `server.js` acts as a local proxy and sends the token only from the local Node.js process.

## Files intentionally ignored

The following files are ignored by Git:

```text
config.json
shockers.json
.env
\*.log
node\_modules/
```

Use:

```text
config.example.json
shockers.example.json
```

as templates.

## Reporting issues

If you find a security issue, do not post real tokens, real shocker IDs, or private OpenShock account data in public GitHub issues.

