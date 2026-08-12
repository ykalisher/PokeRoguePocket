"""Phase 94 verification: lifetime stat counters and achievement unlocks.

Walks a real run through every one of the seven bump sites and checks the
profile in localStorage after each, then reloads on the two screens that can
re-run their bump (the battle result and the completed event) to prove nothing
double-counts.

Each encounter is reached by forcing a trivial `start -> probe-N` graph of the
wanted node type (the same relabel-in-place technique phase 43/78/81/83's
drivers use); walking the generated map to one node of each type is not
reliable. Battles are ended by forcing knockoutCount, as phase 83 does.

Unlocks are never checked by name: which achievements exist is authored data
that changes under this driver. Instead every bump site re-derives the set that
*should* be unlocked from achievements.json plus the counters the profile is
carrying, and asserts the profile matches it exactly and stores it in the
documented format (ISO stamp per unlock, pendingUnlocks a subset of unlocked).
A hardcoded id fails when the owner renames or retires it, which is the inverse
of what this driver is for.

Checks:
  1. starter picked            -> runs.started; the page's achievement list is
                                  the real achievements.json, not the
                                  arena_data.js fallback
  2. wild Pokemon encounter    -> captures.completed
  3. event                     -> events.seen + events.seen.<id>, reload-safe
  4. attack encounter          -> attacks.claimed
  5. mart                      -> marts.visited
  6. battle won                -> battles.won + battles.won.rank.<Rank>,
                                  reload-safe
  7. final gym leader won      -> runs.completed, runs.completed.starter.water,
                                  runs.completed.mono.<TYPE> for exactly the
                                  types every owned Pokemon shares, plus the
                                  battle counters; reload-safe
  8. New Game                  -> the profile survives, runs.started goes to 2
  9. battle lost               -> battles.lost, runs.completed unchanged

Every step also re-checks the unlock set against the counters it just moved.

Usage: .cache/venv/bin/python phase94_achievement_tracking.py
"""

import json
import re
import sys
import time
from pathlib import Path

from lib import discard_a_card, serving, state, sync_playwright, wait_for_player_turn

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

PROFILE_KEY = "pokemon-rogue-pocket-profile"

# The stamp map/profile.js writes for an unlock: new Date().toISOString().
ISO_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

PAGE_ACHIEVEMENT_IDS = """() => (window.CardArena.GameData.achievements || [])
    .map(record => record.id)"""

PROFILE_PROBE = """() => {
    const raw = localStorage.getItem('pokemon-rogue-pocket-profile');
    return raw ? JSON.parse(raw) : null;
}"""

RUN_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"

# Rewrites the graph to start -> probe-N of the given type, back at 'start'
# with no encounter active, so the node is one click away.
FORCE_NODE = """([nodeType, nodeId, level]) => {
    const run = window.PokeRun.loadRunState();

    run.level = level || run.level;
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
    run.area.completedBossNodeId = null;
    run.area.activeAttackNodeId = null;
    run.area.activeBattleNodeId = null;
    run.area.activeCaptureNodeId = null;
    run.area.activeEventNodeId = null;
    run.area.activeMartNodeId = null;
    if (nodeType === 'boss') run.area.bossNodeId = nodeId;
    window.PokeRun.saveRunState(run);
    return nodeId;
}"""

FORCE_EVENT = """([nodeId, eventId]) => {
    const run = window.PokeRun.loadRunState();

    run.eventEncounters = run.eventEncounters || {};
    run.eventEncounters[nodeId] = {
        battleCompleted: false, completed: false, completedAt: null,
        createdAt: new Date().toISOString(), eventId, nodeId,
        resultSummary: [], selectedActionId: null, startedBattle: false
    };
    run.area.activeEventNodeId = nodeId;
    window.PokeRun.saveRunState(run);
}"""

FORCE_KNOCKOUTS = """([side, count]) => {
    const player = CardArena.state.players[side];
    player.knockoutCount = count || player.initialPokemonCount;
}"""


def check(problems, ok, message):
    print(("  OK   " if ok else "  FAIL ") + message)
    if not ok:
        problems.append(message)


def stats(page):
    profile = page.evaluate(PROFILE_PROBE)
    return (profile or {}).get("stats", {})


def check_stat(problems, page, key, expected):
    actual = stats(page).get(key, 0)
    check(problems, actual == expected, f"{key} == {expected} (got {actual})")


def enabled_achievements():
    """The achievements the game will actually evaluate, straight from data."""
    records = json.loads((ROOT / "achievements.json").read_text())
    return [record for record in records if record.get("enabled") is not False]


def threshold(record):
    """Mirrors evaluateAchievements(): a missing/!finite atLeast means 1."""
    value = record.get("atLeast")
    return value if isinstance(value, int) and not isinstance(value, bool) else 1


def check_unlocks(problems, page, label):
    """Asserts the profile's unlock bookkeeping against the live counters.

    Derives the expected set rather than naming ids: an achievement is due
    exactly when its counter has reached its threshold, because every bump site
    calls PokeProfile.record(), which re-evaluates the whole list. Counters only
    ever grow, so the expected set only ever grows too.
    """
    profile = page.evaluate(PROFILE_PROBE) or {}
    counters = profile.get("stats", {})
    unlocked = profile.get("unlocked", {})
    pending = profile.get("pendingUnlocks", [])

    records = enabled_achievements()
    due = {record["id"] for record in records
           if counters.get(record["stat"], 0) >= threshold(record)}

    check(problems, set(unlocked) == due,
          f"{label}: unlocked {sorted(unlocked)} == achievements at threshold {sorted(due)}")

    unstamped = sorted(key for key, value in unlocked.items()
                       if not (isinstance(value, str) and ISO_STAMP.match(value)))
    check(problems, not unstamped,
          f"{label}: every unlock carries an ISO timestamp (unstamped: {unstamped})")

    known = {record["id"] for record in records}
    stray = sorted(set(pending) - (set(unlocked) & known))
    check(problems, not stray,
          f"{label}: pendingUnlocks holds only unlocked, known ids (stray: {stray})")


def goto_area(page, base):
    page.goto(f"{base}/area.html")
    page.wait_for_selector(".area-node", timeout=15000)


def enter_node(page, base, node_type, node_id, level=None):
    """Forces a start -> node_id graph of node_type and clicks the node."""
    goto_area(page, base)
    page.evaluate(FORCE_NODE, [node_type, node_id, level])
    goto_area(page, base)
    page.click(f".area-node[data-node-id='{node_id}']")


def click_end_turn(page):
    """Clicks End Turn, discarding first when the controller demands it."""
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            page.click("[data-action='end-turn']", timeout=1000)
            return True
        except Exception:
            if not discard_a_card(page):
                time.sleep(0.3)
    return False


def finish_battle(page, base, node_type, node_id, losing=False, level=None):
    """Runs a forced battle to its result screen. Returns the encounter rank."""
    enter_node(page, base, node_type, node_id, level)
    page.wait_for_function("() => location.pathname.endsWith('game.html')", timeout=15000)
    page.wait_for_selector("[data-battle-flow-action='start']", timeout=20000)
    rank = page.evaluate(
        "nodeId => window.PokeRun.loadRunState().battleEncounters[nodeId].rank", node_id
    )
    page.click("[data-battle-flow-action='start']")
    wait_for_player_turn(page)
    page.evaluate(FORCE_KNOCKOUTS, ["player" if losing else "opponent", None])
    click_end_turn(page)
    page.wait_for_selector(".battle-result-window", timeout=20000)
    return rank


def mono_types_from_run(run):
    """Independent reimplementation of arena/game.js monoTypeBumps()."""
    collections = run["collections"]
    cards = collections["pokemon"] + collections["bench"]["pokemon"]
    teams = []
    for card in cards:
        record = card["pokemon"]
        types = record.get("types")
        if not isinstance(types, list):
            types = [record.get("type1"), record.get("type2"), record.get("type3")]
        teams.append({t for t in types if t and t != "NONE"})
    if not teams:
        return set()
    return set.intersection(*teams)


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
            if m.type == "error" and "Failed to load resource" not in m.text
            else None,
        )

        # --- 1. a fresh run -------------------------------------------------
        print("1. starter picker -> fresh run")
        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='water']", timeout=15000)
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='water']")
        page.wait_for_selector(".area-node", timeout=15000)

        check_stat(problems, page, "runs.started", 1)

        # arena_data.js falls back to a small embedded achievement list when the
        # fetch fails; every unlock check below would then be measuring fiction.
        page_ids = page.evaluate(PAGE_ACHIEVEMENT_IDS)
        file_ids = [record["id"] for record in json.loads((ROOT / "achievements.json").read_text())]
        check(problems, page_ids == file_ids,
              f"the page loaded achievements.json, not the fallback list "
              f"(page has {len(page_ids)} ids, file has {len(file_ids)})")

        check_unlocks(problems, page, "after the starter pick")

        # --- 2. wild Pokemon encounter --------------------------------------
        print("2. wild Pokemon encounter")
        enter_node(page, base, "capture", "probe-capture")
        page.wait_for_selector(".capture-option[data-capture-option]", timeout=15000)
        page.click(".capture-option[data-capture-option='0']")
        page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=20000)
        check_stat(problems, page, "captures.completed", 1)
        check_unlocks(problems, page, "after a capture")

        # --- 3. event (plus the reload double-count guard) -------------------
        print("3. event")
        enter_node(page, base, "event", "probe-event")
        page.wait_for_function("() => location.pathname.endsWith('event.html')", timeout=15000)
        # A gift event forced in place keeps the id-suffixed counter
        # predictable; which event the map picks depends on the location.
        page.evaluate(FORCE_EVENT, ["probe-event", "sitrus-berry-tree"])
        page.reload()
        page.wait_for_selector("[data-event-action-id]", timeout=15000)
        page.click("[data-event-action-id]")
        page.wait_for_selector("[data-event-continue]", timeout=15000)

        check_stat(problems, page, "events.seen", 1)
        check_stat(problems, page, "events.seen.sitrus-berry-tree", 1)

        page.reload()
        page.wait_for_timeout(1500)
        check_stat(problems, page, "events.seen", 1)
        check(problems, stats(page).get("events.seen.sitrus-berry-tree", 0) == 1,
              "events.seen.sitrus-berry-tree stayed 1 after reloading the event page")
        check_unlocks(problems, page, "after an event")

        # --- 4. attack encounter ---------------------------------------------
        print("4. attack encounter")
        enter_node(page, base, "attack", "probe-attack")
        page.wait_for_selector(".attack-option[data-attack-option]", timeout=15000)
        page.click(".attack-option[data-attack-option='0']")
        page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=20000)
        check_stat(problems, page, "attacks.claimed", 1)
        check_unlocks(problems, page, "after an attack encounter")

        # --- 5. mart ----------------------------------------------------------
        print("5. mart")
        enter_node(page, base, "shop", "probe-shop")
        page.wait_for_selector("[data-mart-action='continue']", timeout=15000)
        page.click("[data-mart-action='continue']")
        page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=20000)
        check_stat(problems, page, "marts.visited", 1)
        check_unlocks(problems, page, "after a mart")

        # --- 6. battle won (plus the reload double-count guard) ---------------
        print("6. battle won")
        rank = finish_battle(page, base, "battle", "probe-battle")
        print(f"   battle rank: {rank}")
        check_stat(problems, page, "battles.won", 1)
        check_stat(problems, page, f"battles.won.rank.{rank}", 1)
        check_unlocks(problems, page, "after a won battle")

        page.reload()
        page.wait_for_selector(".battle-result-window", timeout=20000)
        check_stat(problems, page, "battles.won", 1)
        check(problems, stats(page).get(f"battles.won.rank.{rank}", 0) == 1,
              f"battles.won.rank.{rank} stayed 1 after reloading the result screen")
        page.screenshot(path=str(HERE / "phase94_achievement_tracking.png"))

        page.click("[data-battle-flow-action='continue']")
        page.wait_for_selector(".area-node", timeout=20000)

        # --- 7. run victory ---------------------------------------------------
        print("7. final gym leader (run victory)")
        total_levels = page.evaluate("() => window.PokeLocations.TOTAL_LEVELS")
        run_before = page.evaluate(RUN_PROBE)
        expected_mono = mono_types_from_run(run_before)
        print(f"   owned Pokemon share types: {sorted(expected_mono) or 'none'}")

        boss_rank = finish_battle(page, base, "boss", "probe-boss", level=total_levels)
        print(f"   final gym leader rank: {boss_rank}")
        check_stat(problems, page, "runs.completed", 1)
        # The final battle is still a battle: it bumps the battle counters too.
        check_stat(problems, page, "battles.won", 2)
        check_stat(problems, page, "runs.completed.starter.water", 1)

        mono_keys = {key.rsplit(".", 1)[1] for key in stats(page)
                     if key.startswith("runs.completed.mono.")}
        check(problems, mono_keys == expected_mono,
              f"mono counters {sorted(mono_keys)} match the shared types "
              f"{sorted(expected_mono)}")

        # A victory marks the encounter completed, so a reload no longer finds
        # an active battle at all — the counters must still hold at 1.
        page.reload()
        page.wait_for_timeout(2000)
        check_stat(problems, page, "runs.completed", 1)
        check_stat(problems, page, "runs.completed.starter.water", 1)
        check_unlocks(problems, page, "after the run victory")

        # --- 8. New Game keeps the profile ------------------------------------
        print("8. New Game")
        before_new_game = dict(stats(page))
        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
        page.click(".starter-card[data-starter='fire']")
        page.wait_for_selector(".area-node", timeout=15000)

        after_new_game = stats(page)
        check_stat(problems, page, "runs.started", 2)
        kept = [key for key, value in before_new_game.items()
                if key != "runs.started" and after_new_game.get(key) != value]
        check(problems, not kept, f"every earlier counter survived New Game (lost: {kept})")
        check_unlocks(problems, page, "after New Game")

        # --- 9. battle lost ----------------------------------------------------
        print("9. battle lost")
        finish_battle(page, base, "battle", "probe-loss", losing=True)
        title = page.inner_text(".battle-result-window h1")
        check(problems, title == "You lose", f"loss result screen shown (title: {title!r})")
        check_stat(problems, page, "battles.lost", 1)
        check_stat(problems, page, "runs.completed", 1)
        check_stat(problems, page, "battles.won", 2)

        page.reload()
        page.wait_for_selector(".battle-result-window", timeout=20000)
        check_stat(problems, page, "battles.lost", 1)
        check_unlocks(problems, page, "after a lost battle")

        browser.close()

    # Missing location background images 404 by design (pre-existing gap).
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
