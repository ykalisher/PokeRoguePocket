"""Phase 95 verification: achievements page + cross-page unlock toast.

Checks:
  1. achievements.html renders an unlocked row (with unlock date), a locked
     row with a progress bar, and a hidden locked row showing '???' for both
     name and description; header count matches; back link returns to menu.
  2. Winning a battle on game.html queues 'first-blood', which toasts on the
     very next page load (area.html) and does not toast again afterward.

Usage: .cache/venv/bin/python phase95_achievements.py [shot.png]
"""

import sys
import time
from pathlib import Path

from lib import discard_a_card, serving, sync_playwright, wait_for_player_turn

HERE = Path(__file__).resolve().parent

PROFILE_KEY = "pokemon-rogue-pocket-profile"

SEED_PROFILE = {
    "pendingUnlocks": [],
    "stats": {"events.seen": 10, "runs.started": 1},
    "unlocked": {"first-steps": "2026-01-15T00:00:00.000Z"},
    "version": 1,
}

FORCE_NODE = """([nodeType, nodeId]) => {
    const run = window.PokeRun.loadRunState();

    run.area.graph = {
        columns: [],
        edges: [{ from: 'start', to: nodeId }],
        nodes: [
            { id: 'start', lane: 2, step: 0, type: 'start', x: 5, y: 50 },
            { id: nodeId, lane: 2, step: 1, type: nodeType, x: 50, y: 50 }
        ]
    };
    run.area.currentNodeId = 'start';
    run.area.visitedNodeIds = ['start'];
    run.area.traveledPathKeys = [];
    run.area.completed = false;
    run.area.completedAt = null;
    run.area.activeBattleNodeId = null;
    window.PokeRun.saveRunState(run);
}"""

FORCE_KNOCKOUTS = """() => {
    CardArena.state.players.opponent.knockoutCount = CardArena.state.players.opponent.initialPokemonCount;
}"""


def check(problems, ok, message):
    print(("  OK   " if ok else "  FAIL ") + message)
    if not ok:
        problems.append(message)


def click_end_turn(page):
    """Clicks End Turn, discarding first when the controller demands it.
    checkGameOver() runs synchronously at the top of endPlayerTurn(), so
    state right after this call already reflects its verdict."""
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            page.click("[data-action='end-turn']", timeout=1000)
            return True
        except Exception:
            if not discard_a_card(page):
                time.sleep(0.3)
    return False


def main():
    shot = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "phase95_achievements.png")
    problems = []
    errors = []

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text}")
            if m.type == "error" and "Failed to load resource" not in m.text
            else None,
        )

        # --- 1. the achievements page renders all three row states ---------
        print("1. achievements.html row states")
        page.goto(f"{base}/index.html")
        page.evaluate("() => localStorage.clear()")
        page.evaluate(
            f"""profile => localStorage.setItem('{PROFILE_KEY}', JSON.stringify(profile))""",
            SEED_PROFILE,
        )
        page.goto(f"{base}/achievements.html")
        page.wait_for_selector(".achievement-row", timeout=15000)

        count_text = page.inner_text("#achievement-count")
        check(problems, count_text == "1 / 6", f"header count reads '1 / 6' (got {count_text!r})")

        unlocked_row = page.query_selector(".achievement-row--unlocked")
        check(problems, unlocked_row is not None, "one unlocked row present")
        if unlocked_row:
            name = unlocked_row.query_selector(".achievement-name").inner_text()
            has_date = unlocked_row.query_selector(".achievement-unlocked-at") is not None
            check(problems, name == "First Steps", f"unlocked row shows real name (got {name!r})")
            check(problems, has_date, "unlocked row shows an unlock date")

        wanderer_row = page.query_selector(".achievement-row:has(.achievement-name:text('Wanderer'))")
        check(problems, wanderer_row is not None, "locked 'Wanderer' row present")
        if wanderer_row:
            progress = wanderer_row.query_selector(".achievement-progress-label").inner_text()
            has_bar = wanderer_row.query_selector(".achievement-progress-bar") is not None
            check(problems, progress == "10 / 25", f"progress reads '10 / 25' (got {progress!r})")
            check(problems, has_bar, "progress bar element present")

        names = [el.inner_text() for el in page.query_selector_all(".achievement-name")]
        check(problems, "???" in names, f"a hidden locked row shows '???' for its name (names: {names})")
        hidden_row = page.query_selector(".achievement-row:has(.achievement-name:text('???'))")
        if hidden_row:
            description = hidden_row.query_selector(".achievement-description").inner_text()
            no_progress = hidden_row.query_selector(".achievement-progress-label") is None
            check(problems, description == "???", f"hidden row description is '???' (got {description!r})")
            check(problems, no_progress, "hidden row shows no progress numbers")

        page.screenshot(path=shot)
        print(f"   screenshot: {shot}")

        page.click(".btn-back")
        page.wait_for_function("() => location.pathname.endsWith('index.html')", timeout=10000)
        check(problems, page.query_selector("a[href='achievements.html']") is not None,
              "main menu shows the Achievements link")

        # --- 2. cross-page unlock toast --------------------------------------
        print("2. cross-page unlock toast")
        page.evaluate("() => localStorage.clear()")
        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='water']", timeout=15000)
        page.click(".starter-card[data-starter='water']")
        page.wait_for_selector(".area-node", timeout=15000)

        page.evaluate(FORCE_NODE, ["battle", "probe-battle"])
        page.reload()
        page.wait_for_selector(".area-node", timeout=15000)
        page.click(".area-node[data-node-id='probe-battle']")
        page.wait_for_function("() => location.pathname.endsWith('game.html')", timeout=15000)
        page.wait_for_selector("[data-battle-flow-action='start']", timeout=20000)
        page.click("[data-battle-flow-action='start']")
        wait_for_player_turn(page)
        page.evaluate(FORCE_KNOCKOUTS)

        check(problems, click_end_turn(page), "End Turn accepted after the forced knockout")
        page.wait_for_selector(".battle-result-window", timeout=20000)

        pending = page.evaluate(
            f"() => JSON.parse(localStorage.getItem('{PROFILE_KEY}')).pendingUnlocks"
        )
        check(problems, "first-blood" in pending, f"'first-blood' queued after the win (pending: {pending})")

        page.click("[data-battle-flow-action='continue']")
        page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=20000)
        page.wait_for_selector(".achievement-toast", timeout=10000)
        toast_name = page.inner_text(".achievement-toast-name")
        check(problems, toast_name == "First Blood", f"toast shows 'First Blood' (got {toast_name!r})")

        pending_after = page.evaluate(
            f"() => JSON.parse(localStorage.getItem('{PROFILE_KEY}')).pendingUnlocks"
        )
        check(problems, pending_after == [], f"pendingUnlocks drained after the toast (got {pending_after})")

        page.reload()
        page.wait_for_selector(".area-node", timeout=15000)
        page.wait_for_timeout(500)
        check(problems, page.query_selector(".achievement-toast") is None,
              "no repeat toast on the next page load")

        browser.close()

    real_errors = [e for e in errors if "assets/backgrounds/" not in e]
    for err in real_errors:
        problems.append(err)
        print("  FAIL " + err)

    print("RESULT:", "PASS" if not problems else f"FAIL ({len(problems)} problems)")
    sys.exit(0 if not problems else 1)


if __name__ == "__main__":
    main()
