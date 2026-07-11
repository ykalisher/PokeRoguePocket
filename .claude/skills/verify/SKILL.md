---
name: verify
description: Verify PokeRoguePocket in a real browser — serve on 8931, drive battles with the committed Playwright drivers in dev/verify/, inspect window.CardArena.state, screenshot. Use when a change needs visual or behavioral confirmation beyond the Node tests.
---

# Verify PokeRoguePocket in a browser

Static site, no build step. Surface is the browser GUI. Committed drivers live
in `dev/verify/` — use them, do not rebuild them from scratch.

## One-time setup (per machine)

```bash
bash dev/verify/setup.sh
```

Idempotent; no root needed. Creates `dev/verify/.cache/` with a venv,
Playwright + Chromium, and system libs extracted from debs. The drivers set
`LD_LIBRARY_PATH` themselves.

## Drivers

```bash
cd dev/verify
.cache/venv/bin/python drive_arena.py [shot.png]      # one full player turn + probes
.cache/venv/bin/python autoplay_arena.py [max_turns]  # battle to completion
```

Both exit non-zero on page errors. For custom probes, import `lib.py`:
`fresh_battle()` (serves 8931, clears localStorage, waits for the player
turn, collects page/console errors), `state(page)`, `wait_for_player_turn`,
`play_attack`, `play_item`, `discard_a_card`, `end_turn`.

## Driving the game manually

`game.html` with empty localStorage boots a default battle (You vs Rival) via
`CardArena.Controller.resetPrototype()` — no run/map setup needed.

State is inspectable at `window.CardArena.state` (`phase`, `isResolving`,
`currentPlayer`, `finished`, `turnNumber`, `log`, `players.*`). Input is
unlocked when `phase === 'turn' && !isResolving && currentPlayer === 'player'`.

Click flow per attack: hand card `.hand-row--player [data-card-id].card-kind-attack`
→ user `.side-panel--player .playing-card.is-user-option`
→ target `.playing-card.is-targetable` or group `.played-slots.is-group-target`.
Items: `.card-kind-item` → same target selectors. SELF-target attacks and
SIDE-target items complete without the target click — the reliable success
signal is the card leaving `players.player.hand`, not a target click.
End turn: `[data-action='end-turn']` (enabled once
`CardArena.Controller.canPlayerEndTurn()`). Discard: select a hand card, then
`[data-action='discard-selected']`. Cancel selection: `[data-action='cancel-action']`.

Animation ghosts to screenshot mid-flight (body-level, transient):
`.pokemon-draw-animation-card`, `.draw-animation-card`,
`.attack-animation-card`, `.item-animation-card`, `.discard-animation-card`,
plus `.damage-float` / `.stat-change-float` markers.

## Gotchas

- Clear localStorage before starting; saved battles auto-restore.
- Opponent turn + resolution can take 20s+; poll state, don't sleep blind
  (`wait_for_player_turn` does this).
- The battle DOM re-renders on every state change — click by selector string
  (re-resolved at click time), never via stored element handles.
- Capture `page.on('pageerror')` and console errors — the game logs nothing in
  a clean run except fallback warnings when JSON fetch fails (file://).
