"""Verifies that a run never repeats an event or an opposing trainer.

Drives the real pages: starts a fresh run, checks the level-1 map's trainers
are distinct and recorded in run.usedTrainerNames, forces the boss-cleared
state so area.html advances to level 2, and checks the new map draws trainers
disjoint from level 1. Then rewrites the level-2 graph so every non-boss node
is an event node and walks a whole lane, checking each entered node draws an
event id no other node in the run used.

Usage: .cache/venv/bin/python verify_no_repeat_encounters.py
"""

import sys

from lib import serving, sync_playwright

RUN_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"
WRITE_RUN = "run => localStorage.setItem('pokemon-rogue-pocket-run', JSON.stringify(run))"

# Events eligible at the run's current location — the ceiling on how many
# distinct events one map can draw before the last-resort repeat kicks in.
ELIGIBLE_EVENTS_PROBE = """() => {
    const run = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'));
    return window.PokeEvents.getAvailableEvents(window.CardArena.GameData, run.location)
        .filter(event => window.PokeEvents.eventConditionsMet(run, event))
        .map(event => event.id);
}"""


def trainer_names(run):
    return [e["trainerName"] for e in run["battleEncounters"].values() if e.get("trainerName")]


def start_fresh_run(page, base):
    page.goto(f"{base}/starter.html")
    page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
    page.evaluate("localStorage.clear()")
    page.click(".starter-card[data-starter='fire']")
    page.wait_for_function(
        "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
        timeout=15000,
    )
    page.wait_for_selector(".area-node", timeout=15000)


def reload_area(page, base, run):
    page.evaluate(WRITE_RUN, run)
    page.goto(f"{base}/area.html")
    page.wait_for_selector(".area-node", timeout=15000)
    return page.evaluate(RUN_PROBE)


def check(ok, label, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}: {label}{(' — ' + detail) if detail else ''}")
    return ok and condition


def main():
    ok = True
    errors = []

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        # Missing background/sprite assets 404 on some locations already; only
        # script errors matter here.
        page.on("console", lambda m: errors.append(f"console.error: {m.text}")
                if m.type == "error" and "Failed to load resource" not in m.text else None)

        # --- Level 1: every battle node gets its own trainer, all recorded.
        start_fresh_run(page, base)
        run = page.evaluate(RUN_PROBE)
        level1 = trainer_names(run)
        ok = check(ok, "level 1 map assigns distinct trainers",
                   len(level1) == len(set(level1)) and len(level1) > 1, ", ".join(level1))
        ok = check(ok, "level 1 trainers are recorded in usedTrainerNames",
                   set(level1) <= set(run["usedTrainerNames"]),
                   f"used={run['usedTrainerNames']}")

        # --- Level 2: advancing wipes the encounters but keeps the history.
        run["area"]["completed"] = True
        run["area"]["completedBossNodeId"] = run["area"]["bossNodeId"]
        run = reload_area(page, base, run)
        level2 = trainer_names(run)
        ok = check(ok, "advancing reached level 2", run["level"] == 2, f"level={run['level']}")
        ok = check(ok, "level 2 trainers repeat nobody from level 1",
                   set(level2).isdisjoint(set(level1)) and len(level2) == len(set(level2)),
                   ", ".join(level2))
        ok = check(ok, "usedTrainerNames spans both levels",
                   set(level1 + level2) <= set(run["usedTrainerNames"]),
                   f"{len(run['usedTrainerNames'])} recorded")

        # --- Events: turn the level-2 lane into event nodes and walk it.
        boss_id = run["area"]["bossNodeId"]
        for node in run["area"]["graph"]["nodes"]:
            if node["id"] not in ("start", boss_id):
                node["type"] = "event"
        run["battleEncounters"] = {}
        run = reload_area(page, base, run)
        eligible = page.evaluate(ELIGIBLE_EVENTS_PROBE)

        drawn = []
        for _ in range(6):
            node = page.query_selector(".area-node.is-selectable")
            if not node:
                break
            node_id = node.get_attribute("data-node-id")
            node.click()
            page.wait_for_function("() => location.pathname.endsWith('event.html')", timeout=15000)
            run = page.evaluate(RUN_PROBE)
            encounter = run["eventEncounters"].get(node_id)
            if not encounter:
                errors.append(f"{node_id}: no event encounter was created")
                break
            drawn.append(encounter["eventId"])
            # Resolve the encounter from the outside (its outcome is irrelevant
            # here) so area.html stops redirecting into it and the walk can go
            # on to the next node.
            encounter["completed"] = True
            run["area"]["activeEventNodeId"] = None
            run = reload_area(page, base, run)

        # Every draw is distinct until this location's eligible events run out;
        # only then may the documented last-resort repeat appear.
        distinct_expected = min(len(drawn), len(eligible))
        ok = check(ok, "walked several event nodes", len(drawn) >= 4, f"{len(drawn)} entered")
        ok = check(ok, "no event repeats while the location still has unused ones",
                   len(set(drawn[:distinct_expected])) == distinct_expected,
                   f"{len(eligible)} eligible, drew {', '.join(drawn)}")
        ok = check(ok, "usedEventIds records every drawn event",
                   set(drawn) <= set(run["usedEventIds"]), f"used={run['usedEventIds']}")

        page.goto(f"{base}/area.html")
        page.wait_for_selector(".area-node", timeout=15000)
        page.screenshot(path="verify_no_repeat_encounters.png")
        browser.close()

    if errors:
        ok = False
        print("page errors:")
        for error in errors:
            print(f"  {error}")

    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
