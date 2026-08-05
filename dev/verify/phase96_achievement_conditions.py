"""Phase 96 verification: achievement conditions on an event choice gray out the
action button until the achievement is unlocked in the persistent profile.

Serves a fixture events.json (via page.route, so the tracked events.json stays
untouched) with a choice event whose one choice is gated on the achievement
"first-blood" (mode has; battles.won, not auto-unlocked by starting a run, unlike
"first-steps"). Confirms the button is disabled with the default message while
the profile has no unlocks, then unlocks it directly in the persistent-profile
localStorage key and confirms the button becomes usable.

Usage: .cache/venv/bin/python phase96_achievement_conditions.py
"""

import json
import sys

from lib import serving, sync_playwright

RUN_STATE_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"
PROFILE_KEY = "pokemon-rogue-pocket-profile"


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

        fixture = [{
            "type": "choice", "id": "verify-achievement-condition", "enabled": True,
            "title": "Achievement Probe", "body": "A locked chest waits for a champion.",
            "choices": [
                {"id": "needs-achievement", "title": "Requires an achievement", "buttonText": "Claim",
                 "conditions": [{"subject": "achievement", "mode": "has", "name": "first-blood"}],
                 "effects": [{"type": "gain-cash", "amount": 10}]},
            ],
        }]
        page.route("**/events.json", lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(fixture)))

        def point_at_fixture():
            page.evaluate("""() => {
                const key = 'pokemon-rogue-pocket-run';
                const run = JSON.parse(localStorage.getItem(key));
                run.area.activeEventNodeId = 'verify-node';
                run.area.activeBattleNodeId = null;
                run.area.activeCaptureNodeId = null;
                run.area.activeMartNodeId = null;
                run.eventEncounters = { 'verify-node': {
                    battleCompleted: false, completed: false, completedAt: null,
                    createdAt: new Date().toISOString(), eventId: 'verify-achievement-condition',
                    nodeId: 'verify-node', resultSummary: [], selectedActionId: null,
                    startedBattle: false
                } };
                localStorage.setItem(key, JSON.stringify(run));
            }""")

        point_at_fixture()
        page.goto(f"{base}/event.html")
        page.wait_for_selector(".event-choice-card", timeout=15000)
        page.screenshot(path="phase96_achievement_conditions_locked.png")

        def note_for(action_id):
            card = page.query_selector(f"article.event-choice-card:has(button[data-event-action-id='{action_id}'])")
            if card is None:
                return None
            note = card.query_selector(".event-action-note")
            return note.text_content() if note else None

        def is_disabled(action_id):
            btn = page.query_selector(f"button[data-event-action-id='{action_id}']")
            return btn is not None and btn.get_attribute("disabled") is not None

        disabled = is_disabled("needs-achievement")
        note = note_for("needs-achievement")
        expect_note = 'Requires the "First Blood" achievement.'
        if not disabled:
            ok = False
            print(f"  FAIL needs-achievement: expected disabled while locked, got disabled={disabled}")
        elif note != expect_note:
            ok = False
            print(f"  FAIL needs-achievement (locked): note={note!r}, want {expect_note!r}")
        else:
            print(f"  OK   needs-achievement locked: disabled={disabled} note={note!r}")

        page.evaluate(
            """(key) => {
                const profile = { pendingUnlocks: [], stats: {}, unlocked: { 'first-blood': new Date().toISOString() }, version: 1 };
                localStorage.setItem(key, JSON.stringify(profile));
            }""",
            PROFILE_KEY,
        )
        point_at_fixture()
        page.goto(f"{base}/event.html")
        page.wait_for_selector(".event-choice-card", timeout=15000)
        page.screenshot(path="phase96_achievement_conditions.png")

        disabled = is_disabled("needs-achievement")
        if disabled:
            ok = False
            print(f"  FAIL needs-achievement: expected enabled once unlocked, got disabled={disabled}")
        else:
            print(f"  OK   needs-achievement unlocked: disabled={disabled}")

        page.click("button[data-event-action-id='needs-achievement']")
        page.wait_for_selector("[data-event-continue]", timeout=15000)
        print("  OK   clicking needs-achievement resolved the event ([data-event-continue] appeared)")

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

    print("RESULT:", "OK" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
