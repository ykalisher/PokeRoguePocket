"""Phase 3 verification: level progression, L4 gauntlet, victory, sanitizer churn.

Drives the real pages (area.html/game.html/index.html) via localStorage
surgery rather than playing full battles, per the plan's "targeted checks".

Usage: .cache/venv/bin/python verify_phase3.py
Exits non-zero on any failed assertion or page error.
"""

import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"
failures = []
errors = []


def check(cond, msg):
    print(("  ok  " if cond else " FAIL ") + msg)
    if not cond:
        failures.append(msg)


def get_run(page):
    return page.evaluate(f"JSON.parse(localStorage.getItem({RUN_KEY!r}))")


def set_run(page, run):
    page.evaluate(
        f"(value) => localStorage.setItem({RUN_KEY!r}, value)",
        __import__("json").dumps(run),
    )


def goto(page, base, path):
    page.goto(f"{base}/{path}")
    page.wait_for_timeout(700)


with serving() as base, sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

    # --- Check A: L1 boss clear advances to L2 ------------------------------
    print("\n[A] L1 boss clear -> L2")
    goto(page, base, "area.html?newRun=1")
    run = get_run(page)
    check(run["level"] == 1, f"fresh run starts at level 1 (got {run['level']})")
    l1_types = set(run["location"]["types"])
    l1_id = run["location"]["id"]
    check(run["area"]["bossNodeId"] == "boss-12", f"L1 bossNodeId is boss-12 (got {run['area']['bossNodeId']})")

    run["area"]["completed"] = True
    set_run(page, run)
    goto(page, base, "area.html")
    run = get_run(page)
    check(run["level"] == 2, f"advanced to level 2 (got {run['level']})")
    check(run["location"]["id"] != l1_id, f"new location differs ({run['location']['id']})")
    check(bool(set(run["location"]["types"]) & l1_types), "new location shares a type with L1")
    check(l1_id in run["visitedLocationIds"] and run["location"]["id"] in run["visitedLocationIds"],
          f"visitedLocationIds grew: {run['visitedLocationIds']}")
    check(not run["area"]["completed"] and run["area"]["currentNodeId"] == "start",
          "L2 area state is fresh (not completed, at start)")
    header = page.inner_text("#area-root").upper()  # .area-kicker is CSS-uppercased
    check("LEVEL 2 OF 4" in header, "header shows 'Level 2 of 4'")
    page.screenshot(path="phase3_A_level2.png")

    # --- Check C: sanitizer churn on reload (mid-L2) -----------------------
    print("\n[C] battle encounters stable across reloads (no sanitizer churn)")
    run = get_run(page)
    names1 = {k: v.get("trainerName") for k, v in run.get("battleEncounters", {}).items()}
    check(len(names1) > 0, f"L2 pre-rolled {len(names1)} battle encounters")
    goto(page, base, "area.html")
    goto(page, base, "area.html")
    run = get_run(page)
    names2 = {k: v.get("trainerName") for k, v in run.get("battleEncounters", {}).items()}
    check(names1 == names2, f"trainer assignments unchanged after two reloads ({len(names2)} nodes)")

    # --- Check B1: surgery to L4 gauntlet ----------------------------------
    print("\n[B1] L3 clear -> L4 gauntlet")
    run = get_run(page)
    run["level"] = 3
    run["area"]["completed"] = True
    set_run(page, run)
    goto(page, base, "area.html")
    run = get_run(page)
    check(run["level"] == 4, f"advanced to level 4 (got {run['level']})")
    check(run["area"]["bossNodeId"] == "boss-5", f"L4 bossNodeId is boss-5 (got {run['area']['bossNodeId']})")
    nodes = run["area"]["graph"]["nodes"]
    steps = sorted((n["step"], n["type"]) for n in nodes)
    check(len(nodes) == 6, f"L4 has 6 nodes (got {len(nodes)})")
    check(steps == [(0, "start"), (1, "shop"), (2, "battle"), (3, "battle"), (4, "battle"), (5, "boss")],
          f"L4 gauntlet node layout is linear shop/battles/boss (got {steps})")
    edges = [(e["from"], e["to"]) for e in run["area"]["graph"]["edges"]]
    check(edges == [("start", "node-1-1"), ("node-1-1", "node-2-1"), ("node-2-1", "node-3-1"),
                    ("node-3-1", "node-4-1"), ("node-4-1", "boss-5")],
          f"L4 edges strictly linear (got {edges})")
    elite = next((v["trainerName"] for v in run["battleEncounters"].values() if v.get("rank") == "Elite"), None)
    check(elite is not None, f"L4 battle encounters are Elite-rank (sample trainer: {elite})")
    page.screenshot(path="phase3_B_gauntlet.png")

    # --- Check B2: final-node win -> victory overlay -----------------------
    print("\n[B2] winning the final node ends the run in victory")
    run = get_run(page)
    boss_trainer = run["battleEncounters"].get("boss-5", {}).get("trainerName") or elite
    run["area"]["activeBattleNodeId"] = "boss-5"
    run["area"]["activeCaptureNodeId"] = None
    run["area"]["activeEventNodeId"] = None
    run["area"]["activeMartNodeId"] = None
    run["battleEncounters"]["boss-5"] = {
        "nodeId": "boss-5", "completed": False, "outcome": "win",
        "rank": "Elite", "trainerName": boss_trainer, "rewardCash": 750,
        "rewardCollected": False, "startedAt": "2026-07-13T00:00:00.000Z",
        "finishedAt": "2026-07-13T00:00:01.000Z",
    }
    set_run(page, run)
    page.evaluate("localStorage.removeItem('card-arena-current-battle')")
    goto(page, base, "game.html")
    page.wait_for_timeout(1000)
    victory = page.query_selector(".battle-result-window--victory")
    check(victory is not None, "victory result window rendered")
    if victory:
        check("Champion" in victory.inner_text(), "victory window says 'Champion'")
    run = get_run(page)
    check(run["runCompleted"] is True, "run.runCompleted set to true")
    check(run["area"]["completed"] is True, "run.area.completed set to true")
    page.screenshot(path="phase3_B_victory.png")

    # --- Check B3: area.html victory banner + index Continue ----------------
    print("\n[B3] completed-run area banner + index Continue")
    goto(page, base, "area.html")
    banner = page.query_selector(".area-victory-banner")
    check(banner is not None, "area.html shows the victory banner")
    check("Champion" in page.inner_text("#area-root"), "area header shows Champion")
    page.screenshot(path="phase3_B_banner.png")

    goto(page, base, "index.html")
    load_btn = page.query_selector("#btn-load-game")
    check(load_btn is not None and not load_btn.is_disabled(), "Continue button enabled for completed run")
    load_btn.click()
    page.wait_for_timeout(700)
    check(page.url.endswith("area.html"), f"Continue routes to area.html (got {page.url})")

    browser.close()

print("\n=== page errors ===")
for line in errors:
    print(" ", line)

if failures or errors:
    print(f"\nRESULT: {len(failures)} assertion failure(s), {len(errors)} page error(s)")
    sys.exit(1)
print("\nRESULT: all phase-3 checks passed")
