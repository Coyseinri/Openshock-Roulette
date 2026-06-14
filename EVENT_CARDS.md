# Event Cards

Event cards live in `event-cards.json`. They are rolled before the target spinner. General controls are still in `config.json` under `eventCards`:

```json
{
  "eventCards": {
    "enabled": true,
    "chancePercent": 18,
    "displayDurationMs": 10000
  }
}
```

Each card can contain one or more effects:

```json
{
  "id": "revenge",
  "enabled": true,
  "weight": 10,
  "title": "Revenge",
  "description": "The last shocked player chooses the next target.",
  "targetWheel": true,
  "fateWheel": false,
  "effects": [
    { "type": "manualTargetByLastShocked" }
  ]
}
```

## Stats tracked by the game

The game now keeps per-player stats during the current session:

- `selected`: times the player ended as a final target after event-card changes.
- `shocked`: times the player received a non-zero activation.
- `vibes`: times the player received a zero-value/vibe result.
- `safe`: SAFE rounds while the player was active.
- `allTargeted`: times the player was included by ALL.
- `totalIntensity`: sum of non-zero intensity values received.
- `lastSelectedRound`, `lastShockedRound`, `lastVibeRound`.

These stats reset with **Reset game / escalation** and collar reloads when `autoResetEscalationOnReload` is not disabled.

## Supported target effects

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
- `doubleTarget`
- `addRandomTargets`
- `disableTargetType`
- `multiplyTargetWeight`
- `sharePain`
- `bodyguard`
- `duel`
- `targetChoosesOpponent`
- `chooseTargetByTarget`

Useful selectors for `multiplyTargetWeight` and `forceTargetBySelector`:

- `lastSelected`
- `lastShocked`
- `leastShocked`
- `mostShocked`
- `leastSelected`
- `mostSelected`
- `leastVibed`
- `mostVibed`
- `lowestIntensity`
- `highestIntensity`
- `longestNotSelected`
- `longestNotShocked`

## Supported fate/value effects

- `forceVibrateOnly`
- `forceControlType` with `controlType: "Vibrate"`
- `disableSafe`
- `noMercy`
- `disableFate`
- `multiplyFateWeight`
- `equalFateWeights`
- `invertFateWeights`
- `forceRandomFate`
- `capFateMax`
- `capFateCategory`
- `mercyRound`
- `forceFate`
- `chooseFateByTarget`
- `guaranteedDoubleHit`
- `setDoubleHitChance`
- `valueMultiplier`
- `valueOffset`
- `lastWords`
