"""Phase 6 verification: neutral default theme + per-location theming.

Usage: .cache/venv/bin/python verify_phase6.py

Checks, with screenshots written beside this script as phase6_*.png:
  A. index.html renders the neutral slate default (no green grid, no
     data-location, default --loc-accent).
  B. Three locations (cinder-ridge, frostpeak-pass light, old-boneyard dark):
     forced onto a fresh run, then area -> capture (via a real node click)
     -> mid-battle game.html all carry the palette; accents differ per
     location; battle theme survives re-renders.
  C. No flash-of-neutral: body inline theme is set at DOMContentLoaded,
     before the data fetch resolves.
  D. Background image: a temp PNG at the location's background path shows
     under the scrim; deleting it degrades back to the gradient.
"""

import sys
from pathlib import Path

from lib import ROOT, serving, sync_playwright, wait_for_player_turn, play_attack

HERE = Path(__file__).resolve().parent
RUN_KEY = "pokemon-rogue-pocket-run"
LOCATIONS = ["cinder-ridge", "frostpeak-pass", "old-boneyard"]

FORCE_LOCATION = """(locId) => {
    const loc = window.PokeLocations.getLocationById(window.CardArena.GameData, locId);
    const run = window.PokeRun.loadRunState();
    run.location = window.PokeLocations.createLocationSnapshot(loc);
    window.PokeRun.saveRunState(run);
    return run.location;
}"""

ACTIVATE_BATTLE = """() => {
    const run = window.PokeRun.loadRunState();
    const capId = run.area.activeCaptureNodeId;
    if (capId && run.captureEncounters[capId]) {
        run.captureEncounters[capId].completed = true;
    }
    run.area.activeCaptureNodeId = null;
    const nodeId = Object.keys(run.battleEncounters)
        .find(id => !run.battleEncounters[id].completed);
    run.area.activeBattleNodeId = nodeId || null;
    window.PokeRun.saveRunState(run);
    return nodeId;
}"""

THEME_PROBE = """() => ({
    datasetLocation: document.body.dataset.location || null,
    inlineAccent: document.body.style.getPropertyValue('--loc-accent').trim() || null,
    computedAccent: getComputedStyle(document.body).getPropertyValue('--loc-accent').trim(),
    bgImageToken: getComputedStyle(document.body).getPropertyValue('--page-bg-image').trim(),
    bodyBackground: getComputedStyle(document.body).backgroundImage
})"""


def check(problems, ok, message):
    print(("  OK   " if ok else "  FAIL ") + message)
    if not ok:
        problems.append(message)


def wait_for_run(page):
    page.wait_for_function(
        "window.CardArena && window.CardArena.GameData && window.PokeRun && "
        f"localStorage.getItem('{RUN_KEY}')",
        timeout=15000,
    )


def make_test_png(page, path):
    """Renders a loud gradient in the browser and saves it as the temp image.
    Hash characters are %23-escaped: a raw # would truncate the data: URL."""
    page.goto("data:text/html,<body style=\"margin:0;height:100vh;"
              "background:repeating-linear-gradient(45deg,%23e33,%23e33 40px,%2336e 40px,%2336e 80px)\">")
    page.screenshot(path=str(path))


def run():
    problems = []
    console_errors = []
    temp_bg = None

    with serving() as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda msg: console_errors.append(f"console.error: {msg.text} [{msg.location.get('url', '')}]")
            if msg.type == "error" else None,
        )

        try:
            # --- A. Neutral default on index.html --------------------------
            print("A. index.html neutral default")
            page.goto(f"{base_url}/index.html")
            page.evaluate("localStorage.clear()")
            page.reload()
            page.wait_for_selector(".main-menu")
            probe = page.evaluate(THEME_PROBE)
            check(problems, probe["datasetLocation"] is None, f"no data-location ({probe['datasetLocation']})")
            check(problems, probe["computedAccent"] == "#e0b84f", f"neutral accent ({probe['computedAccent']})")
            check(problems, probe["inlineAccent"] is None, "no inline theme override")
            page.screenshot(path=str(HERE / "phase6_index_neutral.png"))

            accents = {}
            for loc_id in LOCATIONS:
                print(f"B. location {loc_id}")
                # Fresh run, then force this location onto it. Clear storage
                # from index.html — area.html would redirect to a leftover
                # active encounter mid-navigation.
                page.goto(f"{base_url}/index.html")
                page.evaluate("localStorage.clear()")
                page.goto(f"{base_url}/area.html?newRun=1&starter=water")
                wait_for_run(page)
                forced = page.evaluate(FORCE_LOCATION, loc_id)
                expected_accent = forced["theme"]["accent"]

                # C. Flash check: at DOMContentLoaded the inline theme must
                # already be applied (it is set before the data await).
                page.goto(f"{base_url}/area.html", wait_until="domcontentloaded")
                early = page.evaluate(THEME_PROBE)
                check(problems, early["inlineAccent"] == expected_accent,
                      f"theme inline at DOMContentLoaded ({early['inlineAccent']})")

                page.wait_for_selector(".area-node")
                probe = page.evaluate(THEME_PROBE)
                check(problems, probe["datasetLocation"] == loc_id, f"area data-location ({probe['datasetLocation']})")
                check(problems, probe["computedAccent"] == expected_accent,
                      f"area accent {probe['computedAccent']} == {expected_accent}")
                accents[loc_id] = probe["computedAccent"]
                page.screenshot(path=str(HERE / f"phase6_{loc_id}_area.png"))

                # Capture page via a real node click (L1 step 1 is forced capture).
                page.click(".area-node.is-selectable")
                page.wait_for_url("**/capture.html", timeout=15000)
                page.wait_for_selector(".capture-option .playing-card", timeout=15000)
                probe = page.evaluate(THEME_PROBE)
                check(problems, probe["datasetLocation"] == loc_id,
                      f"capture data-location ({probe['datasetLocation']})")
                check(problems, probe["computedAccent"] == expected_accent,
                      f"capture accent ({probe['computedAccent']})")
                page.screenshot(path=str(HERE / f"phase6_{loc_id}_capture.png"))

                # Battle page: activate a pre-seeded battle encounter.
                node_id = page.evaluate(ACTIVATE_BATTLE)
                check(problems, bool(node_id), f"battle encounter available ({node_id})")
                page.goto(f"{base_url}/game.html")
                page.wait_for_selector("[data-battle-flow-action='start']", timeout=15000)
                probe = page.evaluate(THEME_PROBE)
                check(problems, probe["computedAccent"] == expected_accent,
                      f"game.html intro accent ({probe['computedAccent']})")
                page.click("[data-battle-flow-action='start']")
                wait_for_player_turn(page)
                play_attack(page)  # extra re-renders on top of placement/draws
                probe = page.evaluate(THEME_PROBE)
                check(problems, probe["datasetLocation"] == loc_id,
                      f"mid-battle data-location after re-renders ({probe['datasetLocation']})")
                check(problems, probe["computedAccent"] == expected_accent,
                      f"mid-battle accent after re-renders ({probe['computedAccent']})")
                page.screenshot(path=str(HERE / f"phase6_{loc_id}_battle.png"))

            print("B. palettes differ per location")
            check(problems, len(set(accents.values())) == len(LOCATIONS), f"distinct accents {accents}")

            # --- D. Background image under the scrim -----------------------
            print("D. background image check (old-boneyard)")
            # Release the still-active battle so area.html stops redirecting.
            page.evaluate("""() => {
                const run = window.PokeRun.loadRunState();
                run.area.activeBattleNodeId = null;
                window.PokeRun.saveRunState(run);
            }""")
            loc = LOCATIONS[-1]
            bg_rel = page.evaluate(
                "id => window.PokeLocations.getLocationById(window.CardArena.GameData, id).background", loc)
            # Grab the run before make_test_png parks the page on a data: URL,
            # where localStorage is inaccessible.
            run_json = page.evaluate(f"localStorage.getItem('{RUN_KEY}')")
            temp_bg = ROOT / bg_rel
            temp_bg.parent.mkdir(parents=True, exist_ok=True)
            make_test_png(page, temp_bg)

            # The main page's session has already memo-cached this URL as a
            # failed image load, so use a fresh context (fresh cache) with the
            # same run injected.
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page2 = ctx.new_page()
            page2.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
            responses = []
            page2.on("response", lambda r: responses.append((r.url, r.status)))
            page2.goto(f"{base_url}/index.html")
            page2.evaluate(f"value => localStorage.setItem('{RUN_KEY}', value)", run_json)
            page2.goto(f"{base_url}/area.html")
            page2.wait_for_selector(".area-node")
            probe = page2.evaluate(THEME_PROBE)
            check(problems, bg_rel in probe["bodyBackground"], f"image in body background ({bg_rel})")
            statuses = [status for url, status in responses if bg_rel in url]
            check(problems, 200 in statuses, f"background image fetched ({statuses})")
            page2.screenshot(path=str(HERE / "phase6_bg_image.png"))
            # Opaque panels cover most of the body; hide the shell so the
            # scrimmed image itself is visible in the screenshot.
            page2.eval_on_selector(".area-shell", "el => { el.style.visibility = 'hidden'; }")
            page2.screenshot(path=str(HERE / "phase6_bg_image_exposed.png"))

            temp_bg.unlink()
            temp_bg = None
            page2.goto(f"{base_url}/area.html")
            page2.wait_for_selector(".area-node")
            page2.screenshot(path=str(HERE / "phase6_bg_removed.png"))
            ctx.close()
        finally:
            if temp_bg and temp_bg.exists():
                temp_bg.unlink()
            browser.close()

    # Missing background images 404 by design and paint nothing; every other
    # console error is a failure.
    real_errors = [e for e in console_errors if "assets/backgrounds/" not in e]
    ignored = len(console_errors) - len(real_errors)
    if ignored:
        print(f"(ignored {ignored} expected 404s for assets/backgrounds/)")
    for err in real_errors:
        problems.append(err)
        print("  FAIL " + err)

    print("RESULT:", "PASS" if not problems else f"FAIL ({len(problems)} problems)")
    sys.exit(0 if not problems else 1)


if __name__ == "__main__":
    run()
