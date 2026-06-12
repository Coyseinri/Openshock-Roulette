# OpenShock Roulette

A local, browser-based roulette party game for OpenShock.

The app runs on a Windows laptop or any machine with Node.js. It shows a **Target Spinner** and a **Fate Spinner**, talks to OpenShock through a local Node.js proxy, and keeps the OpenShock API token out of the browser.

> **Safety and consent first:** Only use this with informed, sober, consenting adults who can stop at any time. Do not use electrical stimulation on people with heart conditions, epilepsy, implanted medical devices, pregnancy concerns, unknown medical risks, or anyone who has not explicitly agreed to play.

---

## Features

* Local web interface
* OpenShock API proxy through Node.js
* Auto-load OpenShock shockers/collars
* Fallback `shockers.json` support
* Target spinner:
  * Players/collars
  * SAFE
  * SHOCK ALL
* Fate spinner:
  * `0 = Vibe`
  * `1-100 = Shock`
  * Warmup / Low / Medium / High / Brutal / Deathwish
* Configurable fate ranges and weights
* Enable/disable fate categories during the game
* Disabled categories stay visible and crossed out in the odds table
* Odds auto-normalize when categories are disabled
* Escalation system
* Optional no-repeat fate mode
* Hidden double-hit chance
* Random pause before fate spinner
* Random delay before activation
* Player elimination and rejoin
* STOP ALL button

---

## Project structure

```text
openshock-roulette/
├── index.html              # Web UI shell
├── style.css               # UI styling
├── app.js                  # Browser game logic
├── server.js               # Local Node.js server and OpenShock proxy
├── config.example.json     # Example configuration
├── shockers.example.json   # Example fallback shocker list
├── package.json            # npm metadata and start script
├── .gitignore
├── LICENSE
├── SECURITY.md
└── README.md
```

Create your local runtime files from the examples:

```powershell
Copy-Item config.example.json config.json
Copy-Item shockers.example.json shockers.json
```

---

## Requirements

* Node.js LTS
* OpenShock account
* OpenShock API token
* OpenShock hub/controller and paired shockers/collars

---

## Quick start on Windows

Clone or download the repo, then open PowerShell in the project folder.

```powershell
npm install
Copy-Item config.example.json config.json
Copy-Item shockers.example.json shockers.json
$env:OPENSHOCK_TOKEN = "paste-your-token-here"
npm start
```

Open:

```text
http://localhost:8787
```

---

## Running without npm install

This project only uses Node.js built-in modules. You can also run it directly:

```powershell
$env:OPENSHOCK_TOKEN = "paste-your-token-here"
node server.js
```

---

## OpenShock token

The token is read from an environment variable:

```powershell
$env:OPENSHOCK_TOKEN = "paste-your-token-here"
```

This variable can also be hard set in the server.js, but be aware that your token is saved to a readable file.

---

## Configuration

Most game settings live in `config.json`.

Important sections:

```json
{
  "app": {
    "displayTitle": "OpenShock Roulette",
    "subtitle": "A shocking roulette game"
  },
  "targetWheel": {
    "playerWeight": 100,
    "safeWeight": 10,
    "shockAllWeight": 5
  },
  "game": {
    "hiddenDoubleHitChancePercent": 5,
    "pauseBeforeFateMinMs": 1500,
    "pauseBeforeFateMaxMs": 3000,
    "preHitDelayMinMs": 1000,
    "preHitDelayMaxMs": 3000,
    "noRepeatFate": false,
    "escalationEnabled": true,
    "escalationPerRound": 2
  },
  "safety": {
    "serverMaxShockIntensity": 100,
    "serverMaxVibrateIntensity": 100,
    "defaultDurationMs": 700
  }
}
```

The page can edit many of these values and save them back to `config.json`.

---

## Fate wheel defaults

|Category|Range|Default weight|Escalation|
|-|-:|-:|-|
|Vibe|0|18|Down|
|Warmup|1-15|32|Down|
|Low|16-35|24|Neutral|
|Medium|36-55|14|Up|
|High|56-75|7|Up|
|Brutal|76-90|3|Up|
|Deathwish|91-100|1|Up|

Disabled categories remain shown in the odds list but are crossed out. The remaining enabled categories are automatically reweighted.

---

## Auto-loading collars

The server tries to load shockers from OpenShock. If the hub/device name appears as a player, use exclusions in `config.json`:

```json
"shockers": {
  "excludeIds": [
    "hub-or-device-id-here"
  ],
  "excludeNames": [
    "Living Room Hub"
  ]
}
```

If auto-loading does not work, edit `shockers.json`:

```json
[
  {
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "Player 1"
  }
]
```

---

## Safety controls

The app includes:

* STOP ALL button
* Per-player eliminate/rejoin
* Randomized delay settings
* Server-side intensity ceiling
* Server-side duration ceiling
* No token in browser

Recommended real-world rules:

* Agree on max intensity before starting
* Test the collar on every participant first
* Keep the controller nearby
* Let anyone opt out immediately
* Do not use this on intoxicated participants
* Do not leave the game unattended
* Do not rely on software alone for safety

---

## Development notes

The app is intentionally simple:

* No frontend framework
* No database
* No build step
* No external npm dependencies
* One local Node server
* Static frontend files

This makes it easy to run from a laptop at a party without extra infrastructure.

---

## License

MIT License. See `LICENSE`.

---

## Disclaimer

This is a community hobby project and is not affiliated with OpenShock.

Use at your own risk. The author is not responsible for injury, misuse, consent violations, device malfunction, API changes, or unsafe play.


## Event cards

Event cards are configured in `event-cards.json`. The game supports modular target/fate effects, interactive choices, and per-player session statistics for cards such as least shocked, most selected, longest not selected, bodyguard, duel, and share pain. See `EVENT_CARDS.md` for the full card/effect reference.
