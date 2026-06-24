# OpenShock Roulette (OSR) v1.3.1

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

## What's New in v1.3.1

Version 1.3.1 is a stability and cleanup release for the v1.3 game system.

The big thing here is not a shiny new chaos machine. The big thing is that the existing chaos machine is now less likely to fold itself into a cursed pretzel.

### Updated Core Functions

- Frontend code split into focused browser-side modules
- Backend code split into focused server modules
- Cleaner `app.js` and `server.js` entry points
- Host dashboard layout and control improvements
- Private player information moved into a safer collapsible panel
- Manual event card controls added to the host dashboard
- Main screen game-state and pending-item updates improved
- Wait-only event card support added for cards that pause until Continue is pressed
- Default configuration and example config cleanup
- Event card documentation updated to match the current parser

This is still v1.3 gameplay.

It just has fewer wires sticking out of the walls.

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
- Local API token protection
- Fallback shocker configuration

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

Players will quickly discover seventeen reasons why they should not be the target this round.

Private player information can be tucked away so the host can open player links and objectives without immediately putting everyone's secret nonsense on the big screen.

### Audience Dashboard

Audience members can participate without wearing a collar.

Features include:

- Audience voting
- Rewards and modifiers
- Influence future rounds
- Watch friendships collapse in real time

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

## Per-Player Multipliers

Each player can have their own intensity multiplier.

The rolled value is adjusted before being sent to OpenShock.

Examples:

- 50% multiplier -> Roll 80 -> Sends 40
- 75% multiplier -> Roll 80 -> Sends 60
- 100% multiplier -> Roll 80 -> Sends 80

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
- Audience state
- Player statistics
- Round history
- Active game progress

Restarting the server does not erase your terrible score.

---

## Diagnostics

A diagnostics dashboard is included for troubleshooting.

Available at:

```text
http://localhost:8787/diagnostics
```

Useful for checking:

- API activity
- OpenShock requests
- Cache status
- Runtime statistics
- Request logging

Useful when investigating reports such as:
"It shocked me for no reason."
The Host already knew why you got shocked.

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
├── functions/   # Main browser-side game logic and UI modules
├── server/      # Backend app, routes, persistence and OpenShock API handling
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
- OpenShock Account
- OpenShock API Token
- OpenShock Controller / Hub
- Compatible OpenShock devices
- At least two volunteers
- Poor decision-making skills (optional)

---

## Quick Start

```powershell
git clone https://github.com/Coyseinri/Openshock-Roulette.git
cd Openshock-Roulette
npm install
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

If automatic discovery fails, devices can be configured manually in config/shockers.json

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
3. Connect OpenShock devices.
4. Test every device.
5. Confirm the correct player screams - This step is more important than it sounds.
6. Start the OSR server.
7. Open the main screen.
8. Let players and audience scan their QR codes.
9. Begin regretting your life choices.

---

## Basic Gameplay

1. Players join.
2. Audience joins.
3. The host starts a round.
4. Event cards temporarily suspend fairness.
5. A target is selected.
6. Fate is selected.
7. Modifiers are applied.
8. OpenShock executes the result.
9. Players earn points.
10. Players spend points.
11. Repeat until somebody negotiates a peace treaty.

---

## Safety Controls

The application includes:

- STOP ALL button
- Per-player elimination
- Randomized delays
- Server-side safety limits
- API token protection

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
- Documentation and configuration cleanup

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

OpenShock Roulette controls real OpenShock devices.

Use at your own risk.

Unlike the emotional damage caused by the audience, the shocks are measurable.

The author is not responsible for injury, misuse, consent violations, device malfunction, API changes, unsafe play, broken friendships, ruined alliances, suspiciously targeted event cards, or the consequences of trusting the audience.
