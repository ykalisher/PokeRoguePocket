"""Checks the wide-layout rail: controls on the left, buttons at its bottom,
discard/KO piles between the decks and the active slots. Also screenshots the
narrow layout to confirm it is untouched."""

import sys

from lib import fresh_battle

GEOM = """(() => {
    const box = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return {
        board: box('.game-board'),
        status: box('.arena-status'),
        actionBar: box('.action-bar'),
        log: box('.event-log'),
        playerPanel: box('.side-panel--player'),
        pkmnDeck: box('.side-panel--player .pile--pokemon-deck'),
        actionDeck: box('.side-panel--player .pile--deck'),
        discard: box('.side-panel--player .pile--discard'),
        knockout: box('.side-panel--player .pile--knockout'),
        slots: box('.side-panel--player .played-slots')
    };
})()"""

failures = []


def check(label, ok, detail=""):
    print(("  PASS " if ok else "  FAIL ") + label + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


with fresh_battle() as (page, errors):
    for width, height in [(1440, 900), (1280, 720), (1600, 1000)]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(250)
        g = page.evaluate(GEOM)
        print(f"\n{width}x{height}")
        check("controls sit left of the player panel",
              g["status"]["right"] <= g["playerPanel"]["left"] + 1,
              f"status.right={g['status']['right']:.0f} panel.left={g['playerPanel']['left']:.0f}")
        check("buttons sit below the log inside the control box",
              g["actionBar"]["top"] >= g["log"]["bottom"] - 1,
              f"log.bottom={g['log']['bottom']:.0f} bar.top={g['actionBar']['top']:.0f}")
        check("buttons reach the bottom of the control box",
              g["status"]["bottom"] - g["actionBar"]["bottom"] < 20,
              f"status.bottom={g['status']['bottom']:.0f} bar.bottom={g['actionBar']['bottom']:.0f}")
        check("discard/KO sit right of both decks",
              g["discard"]["left"] >= g["actionDeck"]["right"] - 1
              and g["knockout"]["left"] >= g["pkmnDeck"]["right"] - 1)
        check("discard/KO sit left of the active slots",
              g["discard"]["right"] <= g["slots"]["left"] + 1
              and g["knockout"]["right"] <= g["slots"]["left"] + 1,
              f"discard.right={g['discard']['right']:.0f} slots.left={g['slots']['left']:.0f}")
        check("nothing overflows the board horizontally",
              g["slots"]["right"] <= g["board"]["right"] + 1)
        page.screenshot(path=f"/tmp/claude-1000/-home-agent-PokeRoguePocket/508c4093-2cea-4d29-9c6b-46f90b72c79c/scratchpad/wide-{width}x{height}.png")

    # Narrow layout must be unchanged: controls stay a full-width divider band.
    page.set_viewport_size({"width": 900, "height": 900})
    page.wait_for_timeout(250)
    g = page.evaluate(GEOM)
    print("\n900x900 (narrow)")
    check("narrow controls still span the board width",
          g["status"]["right"] - g["status"]["left"] > (g["board"]["right"] - g["board"]["left"]) * 0.9)
    check("narrow discard/KO stay right of the active slots",
          g["discard"]["left"] >= g["slots"]["right"] - 1)
    page.screenshot(path="/tmp/claude-1000/-home-agent-PokeRoguePocket/508c4093-2cea-4d29-9c6b-46f90b72c79c/scratchpad/narrow-900x900.png")

    if errors:
        print("\npage errors:", errors)
        failures.append("page errors")

print("\n" + ("FAILURES: " + ", ".join(failures) if failures else "all layout checks passed"))
sys.exit(1 if failures else 0)
