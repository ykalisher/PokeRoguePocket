"""Verifies the requirement name filter on the real event page: the live
rotom-appliances choices must offer the run's Rotom and nothing else.

Builds a real run via starter.html, grants it a Rotom (the event's `has Rotom`
condition), points the active event node at the tracked rotom-appliances event
(no fixture route -- this drives the real events.json), then opens a form choice
and asserts the picker holds exactly one card, that the starter is absent, and
that confirming swaps only the Rotom for the chosen form.

Usage: .cache/venv/bin/python rotom_form_picker.py
"""

import sys

from lib import serving, sync_playwright

RUN_STATE_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"


def pokemon_names(run):
    collections = run["collections"]
    bench = collections.get("bench") or {}
    cards = list(collections.get("pokemon") or []) + list(bench.get("pokemon") or [])
    return sorted(card["pokemon"]["name"] for card in cards)


def main():
    ok = True
    errors = []
    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text} [{m.location.get('url', '')}]")
            if m.type == "error"
            else None,
        )

        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='fire']")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
            timeout=15000,
        )

        # area.html has run_state.js + event_effects.js + the loaded card data,
        # so the Rotom grant runs through the same engine path the game uses.
        page.wait_for_function(
            "() => window.CardArena && window.CardArena.GameData && (window.CardArena.GameData.pokemon || []).length > 0",
            timeout=15000,
        )
        page.evaluate("""() => {
            const key = 'pokemon-rogue-pocket-run';
            const run = JSON.parse(localStorage.getItem(key));
            PokeEvents.applyEffects(
                run,
                [{ type: 'gain-card', cardKind: 'pokemon', name: 'Rotom', count: 1 }],
                {},
                { gameData: CardArena.GameData, runStore: PokeRun }
            );
            run.area.activeEventNodeId = 'verify-node';
            run.area.activeBattleNodeId = null;
            run.area.activeCaptureNodeId = null;
            run.area.activeMartNodeId = null;
            run.eventEncounters = { 'verify-node': {
                battleCompleted: false, completed: false, completedAt: null,
                createdAt: new Date().toISOString(), eventId: 'rotom-appliances',
                nodeId: 'verify-node', resultSummary: [], selectedActionId: null,
                startedBattle: false
            } };
            localStorage.setItem(key, JSON.stringify(run));
        }""")

        before = pokemon_names(page.evaluate(RUN_STATE_PROBE))
        print(f"run pokemon before: {before}")
        if "Rotom" not in before or len(before) < 2:
            ok = False
            print("  FAIL setup: expected the starter plus a granted Rotom")

        page.goto(f"{base}/event.html")
        page.wait_for_selector(".event-choice-card", timeout=15000)

        page.click("button[data-event-action-id='rotom-microwave']")
        page.wait_for_selector(".event-selection-panel", timeout=15000)
        page.screenshot(path="rotom_form_picker.png")

        labels = [
            (card.get_attribute("aria-label") or "")
            for card in page.query_selector_all(".event-card-choice")
        ]
        print(f"picker offers: {labels}")
        if labels != ["Select Rotom"]:
            ok = False
            print(f"  FAIL picker should offer only Rotom, got {labels}")
        else:
            print("  OK   picker offers only Rotom (starter not selectable)")

        heading = page.text_content(".event-requirement h3") or ""
        if heading.strip() != "Choose your Rotom":
            ok = False
            print(f"  FAIL requirement label is {heading.strip()!r}")
        else:
            print("  OK   requirement label reads 'Choose your Rotom'")

        page.click(".event-card-choice")
        page.wait_for_selector("[data-confirm-event-action]:not([disabled])", timeout=15000)
        page.click("[data-confirm-event-action]")
        page.wait_for_selector("[data-event-continue]", timeout=15000)

        after = pokemon_names(page.evaluate(RUN_STATE_PROBE))
        expected = sorted([name for name in before if name != "Rotom"] + ["Rotom-Heat"])
        print(f"run pokemon after: {after}")
        if after != expected:
            ok = False
            print(f"  FAIL expected {expected}")
        else:
            print("  OK   only Rotom was replaced, by Rotom-Heat")

        # Missing background images 404 by design (see data_validation.test.js
        # "asset warnings include the missing backgrounds") -- unrelated here.
        real_errors = [e for e in errors if "assets/backgrounds/" not in e]
        ignored = len(errors) - len(real_errors)
        if ignored:
            print(f"(ignored {ignored} expected 404s for assets/backgrounds/)")
        if real_errors:
            ok = False
            print("Page/console errors:")
            for e in real_errors:
                print(f"  {e}")

        browser.close()

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
