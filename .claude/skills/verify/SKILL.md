# Verify PokeRoguePocket in a browser

Static site, no build step. Surface is the browser GUI.

## Serve

```bash
cd /home/agent/PokeRoguePocket && python3 -m http.server 8931 --bind 127.0.0.1 &
```

`game.html` with empty localStorage boots a default battle (You vs Rival)
via `CardArena.Controller.resetPrototype()` — no run/map setup needed.

## Browser (no sudo in this env)

Playwright chromium works but the headless shell is missing system libs.
Fix without root by extracting debs locally:

```bash
python3 -m venv scratch/venv && scratch/venv/bin/pip install playwright
scratch/venv/bin/python -m playwright install chromium
apt-get download libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxdamage1 libxres1
for d in *.deb; do dpkg-deb -x "$d" locallibs/; done
LD_LIBRARY_PATH=$PWD/locallibs/usr/lib/x86_64-linux-gnu scratch/venv/bin/python <script>
```

## Driving a battle

State is inspectable at `window.CardArena.state` (`phase`, `isResolving`,
`currentPlayer`, `finished`, `turnNumber`, `log`, `players.*`).
Input is unlocked when `phase === 'turn' && !isResolving && currentPlayer === 'player'`.

Click flow per attack: hand card `.hand-row--player [data-card-id].card-kind-attack`
→ user `.side-panel--player .playing-card.is-user-option`
→ target `.playing-card.is-targetable` or group `.played-slots.is-group-target`.
Items: `.card-kind-item` → same target selectors. End turn:
`[data-action='end-turn']` (enabled once `CardArena.Controller.canPlayerEndTurn()`).

Animation ghosts to screenshot mid-flight (body-level, transient):
`.pokemon-draw-animation-card`, `.draw-animation-card`,
`.attack-animation-card`, `.item-animation-card`, `.discard-animation-card`,
plus `.damage-float` / `.stat-change-float` markers.

Capture `page.on('pageerror')` and console errors — the game logs nothing
in a clean run except fallback warnings when JSON fetch fails (file://).

## Gotchas

- Clear localStorage before starting; saved battles auto-restore.
- Opponent turn + resolution can take 20s+; poll state, don't sleep blind.
- Working scripts from a past session: scratchpad `drive_arena.py`
  (one full turn + probes) and `autoplay_arena.py` (battle to completion).
