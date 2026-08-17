"""Wide-layout follow-ups to the left control rail:

1. the full six-button command bar (targeting phase) still fits the bottom of
   the control box at short wide heights, leaving the log a usable height;
2. dragging a hand card onto the discard pile still works now that the pile
   sits between the decks and the active slots.
"""

import sys

from lib import fresh_battle, state

BAR_GEOM = """(() => {
    const box = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                 width: r.width, height: r.height };
    };
    const bar = document.querySelector('.action-bar');
    const buttons = [...(bar ? bar.querySelectorAll('.arena-button') : [])];
    const rows = new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top)));
    return {
        status: box('.arena-status'),
        bar: box('.action-bar'),
        log: box('.event-log'),
        hand: box('.hand-row--player'),
        buttons: buttons.length,
        buttonRows: rows.size,
        labels: buttons.map(b => b.textContent.trim().replace(/\\s+/g, ' '))
    };
})()"""

CENTER = """sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}"""

failures = []


def check(label, ok, detail=""):
    print(("  PASS " if ok else "  FAIL ") + label + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def shot(page, name):
    page.screenshot(path=f"/tmp/claude-1000/-home-agent-PokeRoguePocket/"
                         f"508c4093-2cea-4d29-9c6b-46f90b72c79c/scratchpad/{name}.png")


with fresh_battle() as (page, errors):
    # --- 1. Full command bar at short wide heights ------------------------
    for width, height in [(1280, 700), (1100, 650), (1920, 720)]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(250)

        # Selecting an attack enters the targeting phase, whose bar carries the
        # widest button set: Cancel, Undo, Discard, Discard Hand, Rules, Menu.
        page.click(".hand-row--player [data-card-id].card-kind-attack")
        page.wait_for_timeout(250)
        g = page.evaluate(BAR_GEOM)
        print(f"\n{width}x{height} — phase={state(page)['phase']} "
              f"{g['buttons']} buttons over {g['buttonRows']} row(s): {', '.join(g['labels'])}")

        check("bar carries the full targeting-phase button set", g["buttons"] == 6)
        check("bar wraps rather than overflowing the control box",
              g["bar"]["left"] >= g["status"]["left"] - 1
              and g["bar"]["right"] <= g["status"]["right"] + 1,
              f"bar=[{g['bar']['left']:.0f},{g['bar']['right']:.0f}] "
              f"box=[{g['status']['left']:.0f},{g['status']['right']:.0f}]")
        check("bar stays inside the control box vertically",
              g["bar"]["bottom"] <= g["status"]["bottom"] + 1,
              f"bar.bottom={g['bar']['bottom']:.0f} box.bottom={g['status']['bottom']:.0f}")
        check("log keeps a usable height under the taller bar",
              g["log"]["height"] >= 80, f"log.height={g['log']['height']:.0f}")
        check("log does not run under the bar",
              g["log"]["bottom"] <= g["bar"]["top"] + 1,
              f"log.bottom={g['log']['bottom']:.0f} bar.top={g['bar']['top']:.0f}")
        shot(page, f"bar-{width}x{height}")

        page.click("[data-action='cancel-action']")
        page.wait_for_timeout(200)

    # --- 2. Drag a hand card onto the relocated discard pile ---------------
    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_timeout(250)

    before = page.evaluate("CardArena.state.players.player.discard.length")
    card_id = page.get_attribute(".hand-row--player [data-card-id]", "data-card-id")
    start = page.evaluate(CENTER, f".hand-row--player [data-card-id='{card_id}']")
    pile = page.evaluate(CENTER, ".side-panel--player [data-pile-type='discard']")
    print(f"\ndrag {card_id}: hand ({start['x']:.0f},{start['y']:.0f}) "
          f"-> discard ({pile['x']:.0f},{pile['y']:.0f})")

    page.mouse.move(start["x"], start["y"])
    page.mouse.down()
    page.mouse.move(start["x"] + 20, start["y"] - 20, steps=4)

    # Mid-flight: the pile must advertise itself as a legal drop target.
    page.mouse.move(pile["x"], pile["y"], steps=12)
    page.wait_for_timeout(120)
    highlighted = page.evaluate(
        "!!document.querySelector(\".side-panel--player [data-pile-type='discard']\")"
        ".classList.contains('is-drop-target')")
    hit = page.evaluate(
        "p => { const el = document.elementFromPoint(p.x, p.y);"
        " return !!(el && el.closest('[data-pile-type=\\\"discard\\\"]')); }", pile)
    check("pointer over the pile hit-tests to the discard pile", hit)
    check("pile highlights as a drop target mid-drag", highlighted)
    shot(page, "drag-over-discard")

    page.mouse.up()
    page.wait_for_timeout(1200)

    after = page.evaluate("CardArena.state.players.player.discard.length")
    in_discard = page.evaluate(
        "id => CardArena.state.players.player.discard.some(c => c.id === id)", card_id)
    in_hand = page.evaluate(
        "id => CardArena.state.players.player.hand.some(c => c.id === id)", card_id)
    check("dropped card left the hand", not in_hand)
    check("dropped card landed in the discard pile", in_discard,
          f"discard {before} -> {after}")
    shot(page, "after-discard-drop")

    if errors:
        print("\npage errors:", errors)
        failures.append("page errors")

print("\n" + ("FAILURES: " + ", ".join(failures) if failures else "all interaction checks passed"))
sys.exit(1 if failures else 0)
