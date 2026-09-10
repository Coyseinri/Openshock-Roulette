# OpenShock Roulette (OSR) v1.4.0

> ## AI Notice
>
> This project contains code written with assistance from AI.
>
> Before anyone starts sharpening pitchforks:
>
> The AI did not design the game.
> The AI did not test the shock collars.
> The AI was absolutely not allowed to control the shock collars.
>
> It mostly wrote code, suggested features, generated bugs, helped fix bugs, and occasionally claimed everything was working while the server was actively on fire.
>
> All final decisions, testing, debugging, balancing and terrible gameplay ideas were performed by actual humans.
>
> Mostly.

---

## What is OpenShock Roulette?

What started as:

> "Pick a random player and shock them."

...somehow evolved into a full multiplayer party game featuring hidden roles, secret objectives, audience participation, event cards, tokens, questionable alliances, betrayals, bribery, and an alarming number of ways for players to make poor life decisions.

OpenShock Roulette is a local browser-based party game built around the OpenShock ecosystem. Players, audience members and the host influence every round through votes, tokens, event cards, objectives and pure chaos.

What could possibly go wrong? - Historically, quite a lot.

---

## What's New in v1.4.0

Version 1.4.0 adds optional Intiface/Toy support and a new Player Setup workflow. A logical player can now use Shock devices, Toys, or both, while the roulette game continues to target the player instead of individual hardware.

### Intiface and Player Setup

- Player Setup at `/setup` for creating players and assigning Shock and Toy devices
- Server-managed connection to Intiface Central
- Persistent Toy profiles and feature mappings that do not depend on temporary device indexes
- Per-feature roles for vibration, rotation, suction, linear and other supported outputs
- Configurable Toy templates, a 10-second flow graph and safe preview controls
- Live connection, device, latency and mapping status
- Player readiness checks before the game starts
- Per-device intensity and duration settings
- OpenShock-only and Toy-only games remain supported

### Unified Gameplay

- One activation path for Shock and Toy devices
- Vibe and Shock outcomes translated to the configured hardware for each player
- Device-aware event cards for Toy, Shock and mixed-provider rounds
- Hardware eligibility checks prevent incompatible event cards from being selected
- Unified output status on the game, setup, host and diagnostics pages
- STOP ALL covers both providers and cancels delayed double hits, event sequences and pending output work

### Safety and Access

- Absolute server-side Shock limit of 99%
- Output limits validated in config and again immediately before OpenShock requests
- Ambiguous identical Toys fail closed until they receive unique Intiface display names
- Remote participants are restricted to the Player, Host or Audience pages and their authorized APIs
- Runtime files, config, logs, databases and server source are excluded from static web access
- Cross-site API mutations are rejected and sensitive access keys are redacted from request logs

The game now supports more hardware, more event combinations and more ways to discover that the innocent-looking Bluetooth device was not, in fact, innocent.

---

## Features

### Core Roulette

- Random player selection
- Random fate selection
- SAFE outcomes
- SHOCK ALL outcomes
- Hidden double-hit chance
- Random execution delays
- Fate weighting system
- Escalation system
- No-repeat fate mode
- Player elimination and rejoin
- STOP ALL button

### OpenShock Integration

- OpenShock API proxy through Node.js
- Automatic device discovery
- Multiple shocker support
- Prefix-based grouped shockers for multi-device players or teams
- Per-device multipliers, even when devices are grouped
- Local API token protection
- Fallback shocker configuration

### Intiface / Toy Integration

Intiface support is optional and disabled by default. OSR connects to Intiface Central through the Node.js server, so the game browser does not manage the hardware connection directly.

Use the two setup pages:

- `/setup` — create logical players, assign devices, test individual outputs and complete game setup
- `/intiface/setup` — inspect device features, assign feature roles, preview templates and manage cached profiles

Start Intiface Central before OSR and keep its WebSocket server available at the configured address. The default is:

```text
ws://127.0.0.1:12345
```

Enable Intiface in `config/config.json`:

```json
"intiface": {
  "enabled": true,
  "websocketUrl": "ws://127.0.0.1:12345",
  "gameIntegrationEnabled": true,
  "autoConnect": true
}
```

Configure every Toy in Advanced Toy Setup before enabling it for gameplay. Give identical devices unique display names in Intiface; OSR intentionally refuses an ambiguous identity instead of guessing which device should activate.

### Configuration export and import

Player Setup can export and import three selectable scopes: logical players, stable device mappings and the reusable game profile. Imports support **Merge** and **Replace selected scopes**. OSR validates the complete file first, shows a grouped change preview, and only enables Apply for that exact validated version. A local backup is created in `data/config-import-backups/` before anything changes.

Exports deliberately omit the OpenShock API token, sessions, audience state, logs, databases, absolute machine paths and temporary Intiface device indexes. Imports are limited to 1 MiB, remain localhost/admin-only, and reject secrets, paths, external references and unsupported schema versions.

### Grouped Shockers

OSR can group multiple OpenShock devices into one logical player or team by using a name prefix.

Example OpenShock device names:

```text
Alice - Arm
Alice - Leg
Team Red - Player 1
Team Red - Player 2
```

With grouped shockers enabled, the target wheel shows the shared prefix as the player or team name. The individual devices stay attached underneath that group.

When a grouped player is selected, OSR expands the hit to every device in that group. Each physical shocker still keeps its own multiplier, so one device can run at 50% while another runs at 75%, because apparently fairness now requires spreadsheet energy.

The host manual shock control can target either the grouped player or one individual device under that group.

Grouping is configured in `config/config.json` / `config/config.example.json`:

```json
"shockers": {
  "grouping": {
    "enabled": true,
    "separator": " - ",
    "trimParts": true,
    "fallbackUngrouped": true
  }
}
```

Reloading shockers also rebuilds the groups, so renaming devices in OpenShock and reloading them is enough to update the logical player list.

Use this for:

- One player wearing multiple devices
- Team-based games
- Group dashboards with shared points, roles, objectives and stats
- Still blaming one person even when two devices fired

### Host Dashboard

The Host controls the game.

Responsibilities include:

- Starting rounds
- Approving audience actions
- Managing players
- Triggering manual shocks
- Managing game settings
- Forcing a specific event card for the next round
- Claiming every bad outcome was intentional

The host is not responsible for the outcome of the game.
The host is, however, responsible for enabling most of the settings that caused it.

### Player Dashboard

Players receive their own dashboard.

Features include:

- Hidden role
- Secret objective
- Point balance
- Token inventory
- Player statistics
- Round history
- Pending actions

Grouped players share the same dashboard, points, tokens, hidden role, objectives and stats. Individual devices remain visible where it matters, especially for multiplier and manual control decisions.

Players will quickly discover seventeen reasons why they should not be the target this round.

Private player information can be tucked away so the host can open player links and objectives without immediately putting everyone's secret nonsense on the big screen.

### Audience Dashboard

Audience members can participate without wearing a collar.

Features include:

- General audience link at `/audience`
- Name-based audience login
- Audience voting
- Rewards and modifiers
- Influence future rounds
- Watch friendships collapse in real time

Audience sessions are intentionally cleared when the server restarts. This prevents a browser from silently reusing an old audience name forever, which is very convenient right up until everyone is suddenly named Roy.

The audience always believes they would make better decisions.

The audience is usually lying.

Audience members gain significant confidence from the fact that they are not wearing shock collars. (Yet)

---

## Hidden Roles

Every player receives a hidden role.

Examples include:

- Survivor
- Merchant
- Bodyguard
- Gambler
- Cultist
- Saboteur
- Martyr
- Chaos Agent

Roles reward specific behaviour and provide alternative ways to earn points.

Roles remain hidden from other players. (Unless somebody leaves their phone unlocked on the table.)

Except for the Chaos Agent.. - Everyone knows who the Chaos Agent is.

---

## Secret Objectives

Every player receives a secret objective.

Completing an objective:

- Grants rewards
- Grants points
- Automatically assigns a new objective

Objectives are private and only visible to the player who owns them.

---

## Public Objectives

Public objectives give the whole group shared goals to work toward.

Only a configured number of public objectives are active at once. When one is completed, OSR rewards the active players and rolls in a new public objective from the pool.

The host can also manually complete or reroll public objectives when the table has clearly achieved greatness, or at least argued convincingly enough.

---

## Per-Player Multipliers

Each player can have their own intensity multiplier.

The rolled value is adjusted before being sent to OpenShock.

Examples:

- 50% multiplier -> Roll 80 -> Sends 40
- 75% multiplier -> Roll 80 -> Sends 60
- 100% multiplier -> Roll 80 -> Sends 80

For grouped shockers, the rolled value is expanded to every device in the group and then each device's own multiplier is applied.

This allows individual balancing for players with different tolerance levels while keeping the game fair for everyone.

Or at least equally unfair.

---

## Tokens & Economy

Players earn points through gameplay, objectives and roles.

Points can be spent on tokens and modifiers that influence future rounds.

Examples include:

- Shields
- Blessings
- Chaos effects
- Protection effects
- Future round modifiers

Because apparently getting shocked wasn't enough. We also needed an economy.
Because every good party game eventually asks the question:
"What if capitalism, but with electricity?"

---

## Event Cards

Event cards can trigger between rounds and temporarily modify gameplay.

Examples include:

- Bodyguard redirects
- Forced targets
- Forced fate values
- Chaos rounds
- Blessings
- Double trouble
- Protection effects
- Audience effects
- Fate manipulation
- Wait-only pauses that require Continue before the round moves on
- Virtual targets that absolutely should not be found in bathtubs

Every round has the potential to become significantly worse.

Some cards change the wheels. Some cards ask the host or target to make a choice. Some cards do nothing except make everyone stop and consider what led them here.

See `EVENT_CARDS.md` for the full reference.

---

## Persistent Sessions

OSR stores active game state in SQLite using a simple session-blob style model.

SQLite is used as a reliable save/session store, not as a giant relational monster hiding under the table.

The following survive server restarts:

- Points
- Tokens
- Roles
- Objectives
- Player statistics
- Round history
- Active game progress

Audience sessions and audience names are intentionally cleared on server restart. Audience votes already accepted into the active game state may still exist, but browser identity is treated as temporary.

Restarting the server does not erase your terrible score.

It does, however, make the audience introduce themselves again like civilized little gremlins.

---

## Diagnostics

A diagnostics dashboard is included for troubleshooting.

Available locally at:

```text
http://localhost:8787/diagnostics
```

The diagnostics page is intended for localhost/admin use. Do not expose it as a public party trick unless your party trick is leaking operational details.

Useful for checking:

- API activity
- OpenShock requests
- OpenShock API key read/control permission checks
- Cache status
- Runtime statistics
- Request logging
- SQLite/session status
- Config validation
- Event-card validation
- Objective and hidden-role validation
- Browser diagnostics
- QR/link generation
- Safe test controls
- Pre-flight readiness checks

Diagnostics exports are redacted by default so obvious secrets are not dumped into bug reports. Still review exports before sharing them, because computers are clever and humans are tired.

Useful when investigating reports such as:
"It shocked me for no reason."

The Host already knew why you got shocked.

Now the diagnostics page might know too.

---

## Project Structure

OSR has been split into smaller frontend and backend modules.

The main entry files still exist, but most of the actual work now lives in more focused folders:

```text
openshock-roulette/
├── config/      # Game config defaults and live config files
├── data/        # Runtime data, SQLite database and session archives
├── logs/        # Runtime logs and diagnostics output
├── host/        # Host dashboard page
├── player/      # Player dashboard page
├── audience/    # Audience dashboard page
├── setup/       # Player and device assignment workflow
├── intiface/    # Advanced Intiface mapping, preview and monitoring UI
├── functions/   # Main browser-side game logic and UI modules
├── server/      # Backend app, routes, persistence and OpenShock API handling
├── tests/       # Node.js regression tests
├── app.js       # Browser entry point
├── server.js    # Node.js server entry point
├── index.html   # Main game screen
├── style.css    # Main game styling
├── package.json # Node.js package metadata and scripts
├── LICENSE
├── README.md
└── EVENT_CARDS.md
```

Frontend modules handle browser-side game logic, wheel rendering, UI updates, player panels, host controls and API calls.

Backend modules handle config loading, routing, OpenShock communication, session persistence, access pages, objectives, roles, economy, diagnostics and validation.

This keeps the game easier to work on without turning `server.js` and `app.js` into cursed scrolls of doom.

Same chaos. Less spaghetti.

---

## Requirements

- Node.js 22 LTS
- At least one output provider:
  - OpenShock account, API token, controller/hub and compatible devices
  - Intiface Central and compatible Bluetooth devices
- A modern browser on the game computer
- Phones or browsers on the same local network for Host, Player and Audience pages
- At least two volunteers
- Poor decision-making skills (optional)

---

## Quick Start

```powershell
git clone https://github.com/Coyseinri/Openshock-Roulette.git
cd Openshock-Roulette
npm install
npm test
npm start
```

Open:

```text
http://localhost:8787
```

Copy `.env.example` to `.env` and configure your OpenShock token.

---

## Auto-loading Shockers

The server automatically attempts to load devices from OpenShock.

If the hub, controller, your smart fridge, your toaster, or some other appliance appears as a player, use exclusions in the configuration.
If your toaster gets selected multiple times in a row, we recommend keeping it away from any nearby bathtubs.

Grouped shockers are enabled by default. Use OpenShock device name prefixes to create logical players or teams:

```text
Player Name - Device Name
```

Examples:

```text
Alice - Arm
Alice - Leg
Team Red - Alice
Team Red - Bob
```

If automatic discovery fails, devices can be configured manually in `config/shockers.json`.

```json
[
  {
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "name": "Player 1"
  },
  {
    "id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
    "name": "Player 2"
  }
]
```

---

## Basic Setup

1. Verify sound-proofing of the room/house you are playing in.
2. Verify everyone consents.
3. Connect the OpenShock devices and/or start Intiface Central.
4. Start the OSR server.
5. Open `/setup` and create or review the players.
6. Assign every Shock and Toy device to the correct player.
7. Open `/intiface/setup` when Toy feature mapping or template testing is required.
8. Test every enabled device at a low setting.
9. Complete Player Setup and open the main screen.
10. Let the Host, Players and Audience scan their QR codes.
11. Begin regretting your life choices.

---

## Basic Gameplay

1. Players join.
2. Audience joins.
3. The host starts a round.
4. Event cards temporarily suspend fairness.
5. A target is selected.
6. Fate is selected.
7. Modifiers are applied.
8. OSR executes the result through the configured Shock and/or Toy devices.
9. Players earn points.
10. Players spend points.
11. Repeat until somebody negotiates a peace treaty.

---

## Safety Controls

The application includes:

- STOP ALL button
- Unified Stop All for OpenShock and Intiface
- Cancellation of pending double hits and event sequences
- Per-player elimination
- Randomized delays
- Server-side safety limits
- Absolute 99% Shock ceiling
- Ambiguous Toy identity blocking
- API token protection
- Local-only root, setup and diagnostics pages
- Role-specific remote participant pages and APIs
- Diagnostics/pre-flight checks

Recommended real-world rules:

- Agree on intensity limits beforehand
- Test devices before starting
- Keep the controller nearby
- Allow immediate opt-out
- Never force participation
- Do not rely solely on software for safety

The STOP ALL button is traditionally discovered approximately one round later than ideal. For best results, locate it before you need it.

---

## Version History

### v1.0

- Simple roulette
- What could possibly go wrong?

### v1.1

- UI improvements
- Fate balancing
- Quality-of-life improvements

### v1.2

- Event cards
- Expanded gameplay modifiers

### v1.3.0

- Host dashboard
- Player dashboard
- Audience dashboard
- Per-player intensity multipliers
- Hidden roles
- Secret objectives
- Audience voting
- Host approvals
- Token economy
- Persistent progression
- Diagnostics dashboard
- Lots more

### v1.3.1

- Frontend and backend modular cleanup
- Host dashboard improvements
- Manual event card controls
- Private player information panel improvements
- Better main-screen state updates
- Wait-only event card support
- Grouped shocker support
- Public objectives
- Documentation and configuration cleanup

### v1.3.2

- Expanded diagnostics and testing dashboard
- Redacted diagnostics export/copy tools
- OpenShock API key permission checks
- Config, event-card and objective validators
- Audience login/session reset on server restart
- Generic audience link cleanup
- Diagnostics and host-dashboard refresh/scroll polish
- Config fallback alignment

### v1.4.0

- Optional Intiface Central and Bluetooth Toy integration
- Player Setup workflow with persistent logical player identities
- Shock, Toy and mixed-device player assignments
- Persistent Toy profiles, feature roles and device mappings
- Template previews, flow graphs, live monitoring and cache controls
- Unified game activation, output status and Stop All behavior
- Device-aware event cards and hardware eligibility checks
- Hard 99% Shock limit and final output-boundary validation
- Participant path isolation and private-file access protection
- Full Node.js regression test command through `npm test`

Things escalated quickly.

---

## Development Notes

The application intentionally remains lightweight:

- No frontend framework
- One local Node.js server
- Static frontend files
- Minimal infrastructure

Future Coyseinri is responsible for maintaining this. Present Coyseinri apologizes.

Future Coyseinri would also like to apologize, but is currently busy fixing bugs introduced by Present Coyseinri.

---

## License

MIT License.

See `LICENSE` for details.

---

## Disclaimer

This is a community hobby project and is not affiliated with OpenShock.

OpenShock Roulette controls real OpenShock and Intiface-compatible devices.

Use at your own risk.

Unlike the emotional damage caused by the audience, the shocks are measurable.

The author is not responsible for injury, misuse, consent violations, device malfunction, API changes, unsafe play, broken friendships, ruined alliances, suspiciously targeted event cards, or the consequences of trusting the audience.
