"""Phase 83 verification: a battle ends only when a side's whole team is
knocked out, not after a flat 4.

Forces a real Gym Leader (boss) battle against Lorelei - a real trainers.json
Elite-rank trainer with 6 Pokemon - by relabeling the next reachable area
node to 'boss' and pre-seeding its battleEncounters entry (same relabel-in-
place technique phase78/80/81's drivers use; organically walking to a boss
node isn't reliable). Elite rank requires run.level 3+ (map/locations.js
LEVEL_CONFIG), so the run's level is forced too.

Checks, against the real running battle:
  1. the opponent brought 6 Pokemon and the KO pill reads "KO 0/6", not
     "KO 0/4";
  2. forcing the opponent to 4/6 knockouts and ending the turn does NOT
     finish the battle (checkGameOver runs synchronously on End Turn click);
  3. the mirror case: forcing the player to 4 knockouts of a 6-team does not
     finish the battle either;
  4. forcing the opponent to 6/6 knockouts and ending the turn DOES finish
     the battle, with the normal win popup, and Continue returns to the map
     with the boss node marked completed.

Usage: .cache/venv/bin/python phase83_full_team_knockout.py
"""

import sys
import time
from pathlib import Path

from lib import discard_a_card, serving, state, sync_playwright, wait_for_player_turn

HERE = Path(__file__).resolve().parent

RELABEL_NEXT_NODE_AS_BOSS = """
() => {
    const run = window.PokeRun.loadRunState();
    run.level = 3;
    const currentId = run.area.currentNodeId;
    const edge = run.area.graph.edges.find(e => e.from === currentId);
    if (!edge) return null;
    const node = run.area.graph.nodes.find(n => n.id === edge.to);
    node.type = 'boss';
    run.battleEncounters[node.id] = {
        completed: false,
        completedAt: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        nodeId: node.id,
        outcome: null,
        rank: 'Elite',
        rewardCash: 250,
        rewardCollected: false,
        startedAt: null,
        trainerName: 'Lorelei'
    };
    window.PokeRun.saveRunState(run);
    return node.id;
}
"""


def check(problems, ok, message):
    print(("  OK   " if ok else "  FAIL ") + message)
    if not ok:
        problems.append(message)


def force_knockouts(page, side, count, team_size=None):
    page.evaluate(
        """([side, count, teamSize]) => {
            const p = CardArena.state.players[side];
            if (teamSize) p.initialPokemonCount = teamSize;
            p.knockoutCount = count;
        }""",
        [side, count, team_size],
    )


def click_end_turn(page):
    """Clicks End Turn, discarding first if the controller demands it.
    checkGameOver() runs synchronously at the top of endPlayerTurn(), so
    state right after this call already reflects its verdict."""
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            page.click("[data-action='end-turn']", timeout=1000)
            return True
        except Exception:
            if not discard_a_card(page):
                time.sleep(0.3)
    return False


def main():
    problems = []
    errors = []

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text} [{m.location.get('url', '')}]")
            if m.type == "error" else None,
        )

        page.goto(f"{base}/area.html?newRun=1&starter=water")
        page.wait_for_selector(".area-node", timeout=15000)

        node_id = page.evaluate(RELABEL_NEXT_NODE_AS_BOSS)
        if not node_id:
            print("FAIL could not find a node reachable from the current node to relabel")
            sys.exit(1)
        page.reload()
        page.wait_for_selector(".area-node", timeout=15000)

        print(f"relabeled {node_id} as a 'boss' node with Lorelei (Elite, 6 Pokemon); entering battle")
        page.click(f".area-node[data-node-id='{node_id}']")
        page.wait_for_url("**/game.html", timeout=15000)
        page.wait_for_selector("[data-battle-flow-action='start']", timeout=15000)
        page.click("[data-battle-flow-action='start']")
        wait_for_player_turn(page)

        # --- 1. opponent brought 6 Pokemon, KO pill reads 0/6 -------------
        opp_initial = page.evaluate("CardArena.state.players.opponent.initialPokemonCount")
        check(problems, opp_initial == 6, f"opponent's initialPokemonCount is 6 (got {opp_initial})")
        pill = page.inner_text(".side-panel--opponent .stat-pill")
        check(problems, pill == "KO 0/6", f"opponent KO pill reads 'KO 0/6' (got {pill!r})")
        page.screenshot(path=str(HERE / "phase83_full_team_knockout.png"))

        # --- 2. opponent at 4/6 knockouts: battle must NOT end ------------
        force_knockouts(page, "opponent", 4)
        check(problems, click_end_turn(page), "End Turn accepted opponent at 4/6 knockouts")
        after_click = state(page)
        check(problems, after_click["finished"] is False,
              f"battle still running at 4/6 opponent knockouts (finished={after_click['finished']})")

        wait_for_player_turn(page)

        # --- 3. mirror case: player at 4 of a forced 6-team ---------------
        force_knockouts(page, "player", 4, team_size=6)
        check(problems, click_end_turn(page), "End Turn accepted player at 4/6 knockouts")
        after_click = state(page)
        check(problems, after_click["finished"] is False,
              f"battle still running at 4/6 player knockouts (finished={after_click['finished']})")

        wait_for_player_turn(page)

        # --- 4. opponent at 6/6 knockouts: battle DOES end -----------------
        force_knockouts(page, "opponent", 6)
        check(problems, click_end_turn(page), "End Turn accepted opponent at 6/6 knockouts")
        page.wait_for_selector(".battle-result-window", timeout=10000)
        final = state(page)
        check(problems, final["finished"] is True, "battle finished once the sixth Pokemon went down")
        title = page.inner_text(".battle-result-window h1")
        check(problems, title == "You won", f"normal win popup shown (title: {title!r})")
        page.screenshot(path=str(HERE / "phase83_full_team_knockout.png"))

        # Continue -> back to the map, boss node completed.
        page.click("[data-battle-flow-action='continue']")
        page.wait_for_url("**/area.html", timeout=15000)
        page.wait_for_selector(".area-node", timeout=15000)
        completed = page.evaluate(
            "nodeId => window.PokeRun.loadRunState().battleEncounters[nodeId].completed", node_id
        )
        check(problems, completed is True, "boss node's battle encounter marked completed after Continue")

    # Missing location background images 404 by design (pre-existing gap,
    # not a regression from this phase) and paint nothing.
    real_errors = [e for e in errors if "assets/backgrounds/" not in e]
    ignored = len(errors) - len(real_errors)
    if ignored:
        print(f"(ignored {ignored} expected 404s for assets/backgrounds/)")
    for err in real_errors:
        problems.append(err)
        print("  FAIL " + err)

    print("RESULT:", "PASS" if not problems else f"FAIL ({len(problems)} problems)")
    sys.exit(0 if not problems else 1)


if __name__ == "__main__":
    main()
