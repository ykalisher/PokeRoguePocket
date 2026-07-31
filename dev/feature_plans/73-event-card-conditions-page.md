# Phase 73 — Event card conditions: gray out the button on the event page

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 72 (the engine exports `getUnmetConditionReason`).
**Read first:** `70-event-card-conditions-overview.md`.
**Goal:** On the real event page, a choice (or trainer payment) whose conditions are unmet
renders as a disabled button with the reason underneath, and a met one stays clickable —
proven with a headless-browser driver and a screenshot.

## Context you need

**The one code change is in `map/event.js`.** `getActionAvailabilityReason(action)`
(~line 606, drift-prone) is what `renderActionCard` (~line 352) and `renderTrainerActions`
(~line 373) call to decide `disabled` plus the `<span class="event-action-note">` text. It
currently reads:

```js
    function getActionAvailabilityReason(action) {
        const requirements = eventSystem.getActionRequirements(action);

        for (const requirement of requirements) {
            if (eventSystem.getSelectableCards(state.run, requirement).length === 0) {
                return requirement.emptyText || 'No cards available.';
            }
        }

        if (requirements.length > 0) return '';

        return eventSystem.getBlockedReason(state.run, action, {}, { … });
    }
```

Note the `if (requirements.length > 0) return '';` short-circuit: for an action that has
card *pickers*, nothing else is evaluated at list time. So the condition check **must go
above the requirements loop**, or a choice that has both a picker and a condition would
never gray out.

The selection panel's footer already covers itself: `renderActiveAction` (~line 404) calls
`eventSystem.getBlockedReason`, which phase 72 taught about conditions. No change there.

**Driver conventions** (`dev/verify/`, Python + Playwright, dev-only, already approved):

- Run drivers with the venv: `dev/verify/.cache/venv/bin/python <script>` from
  `dev/verify/`. `from lib import serving, sync_playwright` — `lib.py` sets
  `LD_LIBRARY_PATH` and serves the repo on `http://127.0.0.1:8931`.
- `dev/verify/phase61_area_selectable.py` is the closest model: it builds a **real** run by
  visiting `starter.html`, clearing `localStorage`, and clicking a starter card
  (`.starter-card[data-starter='fire']`), then waits for `area.html`.
- The run lives in `localStorage` under `pokemon-rogue-pocket-run`.
- `arena/arena_data.js` loads card data with a plain relative `fetch('events.json')`, and
  **falls back to built-in data if the response is unusable** — so a driver that injects a
  fixture must assert the fixture actually rendered, or a silent fallback would pass.
- `event.html` redirects to `area.html` unless `run.area.activeEventNodeId` names an entry
  in `run.eventEncounters` that is not `completed`.

## Steps

- [x] 1. **`map/event.js`** — in `getActionAvailabilityReason`, insert the condition check
  as the first statements of the function, above `const requirements = …`:

  ```js
          const unmetConditionReason = eventSystem.getUnmetConditionReason(state.run, action);

          if (unmetConditionReason) return unmetConditionReason;
  ```

  Nothing else in `map/event.js` changes — no new CSS class, no new markup: the existing
  `disabled` attribute and `.event-action-note` span carry the result.

- [x] 2. **`node tests/run_all.js`** — confirm green before touching the browser.

- [x] 3. **`dev/verify/phase73_event_conditions.py`** — new driver, docstring first
  (`"""Phase 73 verification: … Usage: .cache/venv/bin/python phase73_event_conditions.py"""`).
  Structure it like `phase61_area_selectable.py`: `main()` returning an exit code,
  `pageerror` / `console.error` collectors, `sys.exit(main())`.

  Build a real run first:

  ```python
  page.goto(f"{base}/starter.html")
  page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
  page.evaluate("localStorage.clear()")
  page.click(".starter-card[data-starter='fire']")
  page.wait_for_function(
      "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
      timeout=15000,
  )
  run = page.evaluate("() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))")
  owned = run["collections"]["pokemon"][0]["pokemon"]["name"]
  ```

- [x] 4. **`dev/verify/phase73_event_conditions.py`** — serve a fixture event instead of the
  real `events.json` (keeps the repo file untouched), using `owned` from step 3 and a name
  the run certainly lacks (e.g. `"Nonexistent Probe Mon"`):

  ```python
  fixture = [{
      "type": "choice", "id": "verify-conditions", "enabled": True,
      "title": "Condition Probe", "body": "A humming appliance rattles on the roadside.",
      "choices": [
          {"id": "locked-has", "title": "Needs a card you lack", "buttonText": "Locked",
           "conditions": [{"mode": "has", "cardKind": "pokemon", "name": missing}],
           "effects": [{"type": "gain-cash", "amount": 10}]},
          {"id": "open-has", "title": "Needs a card you own", "buttonText": "Open",
           "conditions": [{"mode": "has", "cardKind": "pokemon", "name": owned}],
           "effects": [{"type": "gain-cash", "amount": 10}]},
          {"id": "locked-lacks", "title": "Blocked because you own it", "buttonText": "Locked",
           "conditions": [{"mode": "lacks", "cardKind": "pokemon", "name": owned}],
           "effects": [{"type": "gain-cash", "amount": 10}]},
      ],
  }]
  page.route("**/events.json", lambda route: route.fulfill(
      status=200, content_type="application/json", body=json.dumps(fixture)))
  ```

- [x] 5. **`dev/verify/phase73_event_conditions.py`** — point the run at that event and open
  the page:

  ```python
  page.evaluate("""() => {
      const key = 'pokemon-rogue-pocket-run';
      const run = JSON.parse(localStorage.getItem(key));
      run.area.activeEventNodeId = 'verify-node';
      run.area.activeBattleNodeId = null;
      run.area.activeCaptureNodeId = null;
      run.area.activeMartNodeId = null;
      run.eventEncounters = { 'verify-node': {
          battleCompleted: false, completed: false, completedAt: null,
          createdAt: new Date().toISOString(), eventId: 'verify-conditions',
          nodeId: 'verify-node', resultSummary: [], selectedActionId: null,
          startedBattle: false
      } };
      localStorage.setItem(key, JSON.stringify(run));
  }""")
  page.goto(f"{base}/event.html")
  page.wait_for_selector(".event-choice-card", timeout=15000)
  ```

- [x] 6. **`dev/verify/phase73_event_conditions.py`** — assert, printing each check so the
  output is readable, and returning 1 on any failure or collected page error:
  - the heading text `Condition Probe` is on the page (proves the fixture loaded and the
    engine did not silently fall back to the real `events.json`);
  - `button[data-event-action-id='locked-has']` has the `disabled` attribute, and its card
    shows a `.event-action-note` reading exactly `Requires {missing}.`;
  - `button[data-event-action-id='open-has']` is **not** disabled and its card has no
    `.event-action-note`;
  - `button[data-event-action-id='locked-lacks']` is disabled with the note
    `You already have {owned}.`;
  - clicking `open-has` still works — after the click the event resolves and the result
    panel's `[data-event-continue]` button appears (that selector is what `map/event.js`
    renders once an action has been applied).
  - screenshot to `dev/verify/phase73_event_conditions.png` before the click.

- [x] 7. Run it: `cd dev/verify && .cache/venv/bin/python phase73_event_conditions.py`.
  Iterate until it exits 0 with no collected page errors. If `page.route` interception
  turns out not to reach the fetch, fall back to temporarily appending the fixture event to
  `events.json`, running the driver, then restoring with `git checkout -- events.json` and
  confirming `git status --porcelain -- events.json` is empty.

- [x] 8. Look at the screenshot (`Read` the PNG) and confirm with your own eyes: two grayed
  buttons with reason text, one live button.

## Verification

- [x] `node tests/run_all.js` green.
- [x] `dev/verify/.cache/venv/bin/python phase73_event_conditions.py` exits 0, printing a
  pass line for each of the five assertions in step 6.
- [x] `dev/verify/phase73_event_conditions.png` exists and visually shows the locked choices
  grayed with their reason text and the satisfiable choice enabled.
- [x] `git status --porcelain` shows only `map/event.js` modified plus the two new
  `dev/verify/phase73_*` files — **`events.json` must be untouched**.

## Out of scope / do not touch

`map/event_effects.js` (done in 72 — if something is missing there, fix it in 72's file and
say so, don't work around it here), `dev/editor/**` (phases 74–75), `events.json` content,
`static/styles.css`, and the existing verify drivers/screenshots. Do not restyle the event
page or invent a lock icon — this phase reuses the existing disabled-button + note pattern.
