# Event Cards

Event cards live in `config/event-cards.json`.

The default reference set lives in `config/event-cards.example.json`.

Event cards are rolled before the target spinner. They can alter the target wheel, alter the fate wheel, force a choice, pause the round, or generally make the host look like they planned this all along.

## Global config

Event card settings are controlled from the `events.eventCards` block in `config/config.json` and `config/config.example.json`.

```json
{
  "events": {
    "eventCards": {
      "enabled": true,
      "chancePercent": 45,
      "displayDurationMs": 7000
    }
  }
}
```

| Setting | Meaning |
| --- | --- |
| `enabled` | Enables or disables random event-card rolls. |
| `chancePercent` | Percent chance that a normal round triggers an event card. Clamped between `0` and `100`. |
| `displayDurationMs` | Default time the event card overlay stays visible before Continue can move things along. |

`config/event-cards.example.json` also has its own top-level fallback values for the card pack. The main live runtime default comes from `events.eventCards` in `config/config.json`. Per-card `displayDurationMs` values still override both, because of course the cards also wanted opinions.

The host dashboard can also force a specific event card for the next round. Forced event cards bypass the normal random chance check.

## Basic card structure

```json
{
  "id": "example-card",
  "enabled": true,
  "weight": 5,
  "title": "Example Card",
  "description": "This card does something deeply questionable.",
  "category": "chaos",
  "targetWheel": true,
  "fateWheel": true,
  "displayDurationMs": 7000,
  "effects": [
    { "type": "multiplyFateWeight", "fateKey": "high", "multiplier": 2 }
  ]
}
```

| Property | Required | Meaning |
| --- | --- | --- |
| `id` | Recommended | Stable card identifier. Used by forced event-card selection. |
| `enabled` | No | Set to `false` to disable the card. Missing means enabled. |
| `weight` | No | Weighted roll value. Higher means more likely. Missing defaults to `1`. |
| `title` | Recommended | Card title shown on screen. |
| `description` | Recommended | Card description shown on screen. |
| `category` | No | Visual grouping/tone. Common values: `good`, `evil`, `chaos`, `neutral`. |
| `targetWheel` | No | Marks the card as affecting the target wheel. Also used by the UI. |
| `fateWheel` | No | Marks the card as affecting the fate wheel. Also used by the UI. |
| `displayDurationMs` | No | Per-card overlay duration override. |
| `durationMs` | No | Alias used for display duration fallback. |
| `displayMs` | No | Alias used for display duration fallback. |
| `waitOnly` | No | Marks a card as a pause/continue card with no required parsed effects. |
| `effects` | Recommended | Array of effect objects. |

## Effect input formats

The parser accepts these formats:

```json
{
  "effects": [
    { "type": "forceFate", "fateKey": "medium" }
  ]
}
```

```json
{
  "effect": { "type": "forceVibrateOnly" }
}
```

```json
{
  "modifiers": [
    { "type": "valueMultiplier", "multiplier": 0.5 }
  ]
}
```

```json
{
  "type": "forceVibrateOnly"
}
```

Recommended style is always:

```json
"effects": [
  { "type": "someEffect" }
]
```

The other formats exist because old cards and quick experiments happened. As is tradition.

Effect type can also be read from:

- `type`
- `name`
- `action`
- `effectType`

Again: use `type` unless you enjoy future-you swearing at past-you.

## Wait-only events

A wait-only card pauses the event flow and waits for the Continue button before moving to the target spin.

Use this when the card is narrative, physical-table-action based, or requires the host/players to do something outside the app before the round continues.

```json
{
  "id": "pause-example",
  "enabled": true,
  "weight": 5,
  "title": "Pause Example",
  "description": "Do the thing. Press Continue when ready.",
  "waitOnly": true,
  "targetWheel": true,
  "fateWheel": true,
  "effects": []
}
```

Rules:

- `waitOnly: true` means no parsed effects are required.
- The card still appears as the active event card.
- The round continues only after Continue.
- Use `targetWheel` and/or `fateWheel` to describe what the card is conceptually waiting before.
- Do not add fake effects just to avoid warnings. That is how gremlins get into the wall.

## Event flow

Normal event flow:

1. Host starts the round.
2. Pending forced event-card modifiers are checked.
3. Event cards roll using `chancePercent` unless forced.
4. The selected card is shown in the event panel and overlay.
5. Interactive pre-target effects run first.
6. Non-interactive effects are applied to the round state.
7. The card waits for Continue.
8. Target spin starts unless an effect forced/skipped it.
9. Post-target interactive effects run after the target is known.
10. Fate spin runs unless an effect forced/skipped it.
11. Value modifiers are applied before sending to OpenShock.

The final OpenShock value is still capped by server-side safety limits and per-player multipliers are still applied before sending.

## Stats used by event cards

The game tracks per-player stats during the current session:

| Stat | Meaning |
| --- | --- |
| `selected` | Times the player ended as a final target after event-card changes. |
| `shocked` | Times the player received a non-zero activation. |
| `vibes` | Times the player received a zero-value/vibe result. |
| `safe` | SAFE rounds while the player was active. |
| `allTargeted` | Times the player was included by ALL. |
| `totalIntensity` | Sum of non-zero intensity values received. |
| `lastSelectedRound` | Last round the player was selected. |
| `lastShockedRound` | Last round the player was shocked. |
| `lastVibeRound` | Last round the player received vibe. |

These stats reset with a game reset/session reset. They are used by selector-based event cards.

## Target effects

### Manual target selection

| Effect | Meaning |
| --- | --- |
| `manualTargetByLastShocked` | The last shocked player manually picks the next target. |
| `manualTargetByHost` | The host manually picks the next target. |
| `groupVoteTarget` | The group manually picks the next target through host buttons. |

Example:

```json
{
  "type": "manualTargetByHost"
}
```

### Target exclusions

| Effect | Meaning |
| --- | --- |
| `excludeLastTarget` | Removes the previous selected target from the target wheel this round. |
| `excludeLastShocked` | Removes the last shocked player or players from the target wheel this round. |

Example:

```json
{
  "type": "excludeLastTarget"
}
```

### Forced targets

These effects force a target and skip the normal target spinner when a valid player exists.

| Effect | Meaning |
| --- | --- |
| `forcePreviousTarget` | Forces the previous selected target. |
| `forceLastShockedTarget` | Forces the last shocked player. |
| `forceLeastShockedTarget` | Forces the player with the fewest shocks. |
| `forceMostShockedTarget` | Forces the player with the most shocks. |
| `forceLeastSelectedTarget` | Forces the player selected the fewest times. |
| `forceMostSelectedTarget` | Forces the player selected the most times. |
| `forceLeastVibedTarget` | Forces the player with the fewest vibe results. |
| `forceMostVibedTarget` | Forces the player with the most vibe results. |
| `forceLowestIntensityTarget` | Forces the player with the lowest total shock intensity. |
| `forceHighestIntensityTarget` | Forces the player with the highest total shock intensity. |
| `forceLongestNotSelectedTarget` | Forces the player who has gone longest without being selected. |
| `forceLongestNotShockedTarget` | Forces the player who has gone longest without being shocked. |
| `forceTargetBySelector` | Forces a player using a selector value. |
| `forceAllTargets` | Forces ALL as the target. |

Example:

```json
{
  "type": "forceLeastShockedTarget"
}
```

Example using a selector:

```json
{
  "type": "forceTargetBySelector",
  "selector": "longestNotSelected",
  "labelPrefix": "The wheel remembers"
}
```

### Target selectors

Selectors can be used by `forceTargetBySelector` and `multiplyTargetWeight`.

| Selector | Meaning |
| --- | --- |
| `lastSelected` | Previous selected target. |
| `lastShocked` | Last shocked player. |
| `leastSelected` | Player selected the fewest times. |
| `mostSelected` | Player selected the most times. |
| `leastVibed` | Player with the fewest vibe results. |
| `mostVibed` | Player with the most vibe results. |
| `lowestIntensity` | Player with the lowest total intensity. |
| `highestIntensity` | Player with the highest total intensity. |
| `longestNotSelected` | Player who has gone longest without being selected. |
| `longestNotShocked` | Player who has gone longest without being shocked. |

### Target wheel modifiers

| Effect | Fields | Meaning |
| --- | --- | --- |
| `disableTargetType` | `targetType` or `value` | Removes a target segment type, usually `safe` or `all`. |
| `doubleSafeWeight` | none | Doubles the SAFE target segment weight. |
| `multiplyTargetWeight` | `selector`, `targetType`, `targetId`, `multiplier` | Multiplies matching target segment weight. |
| `addVirtualTarget` | `id`, `name`, `weight`, `resultText` | Adds a fake target segment that does not affect a real player. |

Examples:

```json
{
  "type": "disableTargetType",
  "targetType": "all"
}
```

```json
{
  "type": "multiplyTargetWeight",
  "selector": "leastShocked",
  "multiplier": 4
}
```

```json
{
  "type": "addVirtualTarget",
  "id": "virtual-toaster",
  "name": "Toaster",
  "weight": 400,
  "resultText": "Toaster had a malfunction. Better unplug it before it is found in the bathtub."
}
```

### Extra targets

| Effect | Fields | Meaning |
| --- | --- | --- |
| `doubleTarget` | none | Adds one extra random player after the main target is selected. |
| `addRandomTargets` | `count` | Adds one or more extra random players after the main target is selected. |

Example:

```json
{
  "type": "addRandomTargets",
  "count": 2
}
```

## Post-target interactive effects

These effects happen after the target is known.

| Effect | Meaning |
| --- | --- |
| `sharePain` | The target chooses another player to join them. |
| `chooseTargetByTarget` | Same behavior as `sharePain`; the target chooses another player. |
| `mutualDestruction` | The target chooses another player to share the same final result, including double-hit behavior. |
| `bodyguard` | Host chooses a volunteer to replace the original target. If nobody volunteers, the original target stays. |
| `duel` | Target chooses an opponent. A random loser receives the fate. |
| `targetChoosesOpponent` | Same behavior as `duel`. |
| `chooseFateByTarget` | Target chooses from configured fate/value options. |
| `lastWords` | Target gets a pause before the round continues. |

Example:

```json
{
  "type": "sharePain"
}
```

Example with optional no-extra-target choice:

```json
{
  "type": "chooseTargetByTarget",
  "allowNone": true
}
```

Example fate choice:

```json
{
  "type": "chooseFateByTarget",
  "choices": [
    { "label": "Low for sure", "fateKey": "low" },
    { "label": "Spin the fate wheel", "fateKey": null },
    { "label": "Double-Hit Medium", "fateKey": "medium", "doubleHitChance": 100 }
  ]
}
```

Supported choice fields for `chooseFateByTarget`:

| Field | Meaning |
| --- | --- |
| `label` | Button text. |
| `fateKey` | Forces a specific fate key. Use `null` to keep/spin normal fate. |
| `forceValue` | Forces a numeric value, such as `0` for vibe. |
| `valueMultiplier` | Overrides the round value multiplier. |
| `valueOffset` | Overrides/adds the round value offset. |
| `forceRandomFateKeys` | Restricts fate to a random pick from these keys. |
| `fateKeys` | Alias for `forceRandomFateKeys`. |
| `doubleHitChance` | Overrides double-hit chance. |

## Fate and value effects

### Force or restrict fate

| Effect | Fields | Meaning |
| --- | --- | --- |
| `forceVibrateOnly` | optional `fateKey` | Forces the result to VIBE/zero value. Defaults fate key to `vibe`. |
| `forceControlType` | `controlType: "Vibrate"` | Also forces VIBE/zero value when the control type is Vibrate. |
| `forceFate` | `fateKey`, `fateId`, or `value` | Forces one specific fate key. |
| `forceRandomFate` | `fateKeys`, `fateIds`, or `values` | Forces fate to a random enabled key from the supplied list. |
| `disableFate` | `fateKey` or `fateId` | Removes one fate key from the fate wheel this round. |

Example:

```json
{
  "type": "forceFate",
  "fateKey": "high"
}
```

### Fate weight modifiers

| Effect | Fields | Meaning |
| --- | --- | --- |
| `multiplyFateWeight` | `fateKey` or `fateId`, `multiplier` | Multiplies one fate category weight. |
| `equalFateWeights` | none | Gives all enabled fate categories equal weight. |
| `invertFateWeights` | none | Inverts fate weights for this round. |

Example:

```json
{
  "type": "multiplyFateWeight",
  "fateKey": "brutal",
  "multiplier": 2
}
```

### Fate caps and mercy effects

| Effect | Fields | Meaning |
| --- | --- | --- |
| `capFateMax` | `max`, `value`, or `maxValue` | Caps the maximum allowed fate value. |
| `capFateCategory` | `value` | Caps fate at the max of the named fate category. |
| `mercyRound` | optional `value` | Caps fate at Medium by default. |
| `disableSafe` | none | Removes SAFE-style target/fate outcomes where applicable. |
| `noMercy` | none | Same behavior as `disableSafe`. |

Example:

```json
{
  "type": "capFateCategory",
  "value": "medium"
}
```

Legacy aliases normalized to `disableSafe`:

- `removeSafe`
- `removeSAFE`
- `disableSafeTarget`
- `disableTargetSafe`
- `noSafeTarget`

Legacy aliases normalized to `forceVibrateOnly`:

- `forceVibe`
- `vibeOnly`
- `vibrateOnly`

### Double-hit effects

| Effect | Fields | Meaning |
| --- | --- | --- |
| `guaranteedDoubleHit` | none | Sets double-hit chance to `100`. |
| `setDoubleHitChance` | `percent` or `value` | Sets double-hit chance between `0` and `100`. |

Example:

```json
{
  "type": "setDoubleHitChance",
  "percent": 50
}
```

### Value modifiers

| Effect | Fields | Meaning |
| --- | --- | --- |
| `valueMultiplier` | `multiplier` or `value` | Multiplies the final rolled value. |
| `valueOffset` | `offset` or `value` | Adds to the final rolled value. |

Example:

```json
{
  "type": "valueMultiplier",
  "multiplier": 0.5
}
```

```json
{
  "type": "valueOffset",
  "offset": 15
}
```

Safety note: value modifiers do not bypass the server-side safety maximum. The app still caps the final send value and applies per-player multipliers before OpenShock receives the command.

## Combining effects

Cards can combine multiple effects. Effects are read in order, but the final result depends on where they apply in the round flow.

Example:

```json
{
  "id": "loaded-mercy",
  "enabled": true,
  "weight": 4,
  "title": "Loaded Mercy",
  "description": "SAFE is removed, but fate is capped at Medium.",
  "targetWheel": true,
  "fateWheel": true,
  "effects": [
    { "type": "disableTargetType", "targetType": "safe" },
    { "type": "capFateCategory", "value": "medium" }
  ]
}
```

## Practical card examples

### Force the least shocked player

```json
{
  "id": "villain-arc",
  "enabled": true,
  "weight": 6,
  "title": "Villain Arc",
  "description": "The player who has been shocked the least becomes the target.",
  "targetWheel": true,
  "effects": [
    { "type": "forceLeastShockedTarget" }
  ]
}
```

### Add one extra target

```json
{
  "id": "double-trouble",
  "enabled": true,
  "weight": 6,
  "title": "Double Trouble",
  "description": "A second random player joins the selected target.",
  "targetWheel": true,
  "effects": [
    { "type": "doubleTarget" }
  ]
}
```

### Force VIBE only

```json
{
  "id": "vibe-check",
  "enabled": true,
  "weight": 8,
  "title": "Vibe Check",
  "description": "No shock this round. Fate is forced to vibration.",
  "fateWheel": true,
  "effects": [
    { "type": "forceVibrateOnly" }
  ]
}
```

### Target chooses their fate

```json
{
  "id": "choose-your-fate",
  "enabled": true,
  "weight": 6,
  "title": "Choose Your Fate",
  "description": "After the target is selected, they choose between Medium for sure or spinning the fate wheel.",
  "fateWheel": true,
  "effects": [
    {
      "type": "chooseFateByTarget",
      "choices": [
        { "label": "Medium for sure", "fateKey": "medium" },
        { "label": "Spin the fate wheel", "fateKey": null }
      ]
    }
  ]
}
```

### Wait-only pause

```json
{
  "id": "pause-before-target",
  "enabled": true,
  "weight": 5,
  "title": "Pause Before Target",
  "description": "Resolve the table action. Press Continue when ready.",
  "waitOnly": true,
  "targetWheel": true,
  "fateWheel": true,
  "effects": []
}
```

### Mutual destruction

```json
{
  "id": "mutual-destruction",
  "enabled": true,
  "weight": 3,
  "title": "Mutual Destruction",
  "description": "The target chooses another player to share their fate. Both players receive the same result, including double-hits.",
  "targetWheel": true,
  "fateWheel": true,
  "effects": [
    { "type": "mutualDestruction" }
  ]
}
```

## Currently supported effect list

Target/pre-target effects:

- `manualTargetByLastShocked`
- `manualTargetByHost`
- `groupVoteTarget`
- `excludeLastTarget`
- `excludeLastShocked`
- `forcePreviousTarget`
- `forceLastShockedTarget`
- `forceLeastShockedTarget`
- `forceMostShockedTarget`
- `forceLeastSelectedTarget`
- `forceMostSelectedTarget`
- `forceLeastVibedTarget`
- `forceMostVibedTarget`
- `forceLowestIntensityTarget`
- `forceHighestIntensityTarget`
- `forceLongestNotSelectedTarget`
- `forceLongestNotShockedTarget`
- `forceTargetBySelector`
- `forceAllTargets`
- `disableTargetType`
- `doubleSafeWeight`
- `multiplyTargetWeight`
- `addVirtualTarget`
- `doubleTarget`
- `addRandomTargets`

Post-target interactive effects:

- `sharePain`
- `chooseTargetByTarget`
- `mutualDestruction`
- `bodyguard`
- `duel`
- `targetChoosesOpponent`
- `chooseFateByTarget`
- `lastWords`

Fate/value effects:

- `forceVibrateOnly`
- `forceControlType`
- `forceFate`
- `forceRandomFate`
- `disableFate`
- `multiplyFateWeight`
- `equalFateWeights`
- `invertFateWeights`
- `capFateMax`
- `capFateCategory`
- `mercyRound`
- `disableSafe`
- `noMercy`
- `guaranteedDoubleHit`
- `setDoubleHitChance`
- `valueMultiplier`
- `valueOffset`

## What not to do

Do not document or depend on an effect unless it is actually handled by the current event-card engine.

Do not add empty placeholder effects to wait-only cards.

Do not assume a card works just because it looks cool in JSON.

That path leads to the traditional debugging chant:

> Why did nothing happen?
> Why is the host sweating?
> Why is the toaster in the player list again?
