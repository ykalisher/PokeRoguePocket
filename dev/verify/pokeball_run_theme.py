"""Verifies the Poke Ball colour scheme on the location-themed pages.

pokeball_theme.py covers the pages that are always red (home, starter, card
overview, achievements, 404). This one covers the pages that wear the ball in
the current location's colour — the area map, capture, mart, event and attack
encounters, the battle board — plus the dev data editor, which is red again.

Checks, with screenshots written beside this script as pokeball_run_*.png:

  A. Two locations with very different accents (a green forest, a purple lake)
     each build their pages' shell from their own accent, and the two never
     render the same shell.
  B. Every shell panel carries the ball's band as a fat ink bottom edge, and
     its title and kicker stay legible on the shell fill.
  C. The map's wild-encounter node — a drawn Poke Ball — takes the location
     accent for its top half and stays ink/off-white below.
  D. The battle board reads as the ball: accent edge on the rival half, band
     between the halves, off-white edge on your half.
  E. No page scrolls horizontally, at a phone or a desktop viewport.
  F. The dev editor wears the red ball: red header over an ink band, an
     off-white active tab with ink text, and a red primary button.

Usage: .cache/venv/bin/python pokeball_run_theme.py
"""

import sys
from pathlib import Path

from drive_editor import serving_editor
from lib import serving, sync_playwright, wait_for_player_turn

HERE = Path(__file__).resolve().parent
RUN_KEY = "pokemon-rogue-pocket-run"

# Two locations whose accents are far apart in hue, so "the shell follows the
# location" cannot pass by accident.
LOCATIONS = ["viridian-forest", "lake-valor"]

# (node type, page it opens, a selector that proves the page rendered)
ENCOUNTERS = [
    ("capture", "capture.html", ".capture-topbar"),
    ("shop", "mart.html", ".mart-topbar"),
    ("event", "event.html", ".event-topbar"),
    ("attack", "attack.html", ".attack-topbar"),
]

INK = [13, 16, 20]
# The editor is not a run page, so it keeps the light theme's softer ink.
INK_LIGHT = [36, 39, 44]
STEEL = [195, 200, 207]
PB_RED = [227, 53, 13]
WHITE = [255, 255, 255]

# Anything that came out of a color-mix() serialises as color(srgb ...), so
# colours are resolved to plain 8-bit rgb by painting them on a 1x1 canvas in
# the page. Spliced into the probes below, which reuse the one canvas.
RESOLVER = """(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return (value) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        return [data[0], data[1], data[2]];
    };
})()"""

FORCE_LOCATION = """(locId) => {
    const loc = window.PokeLocations.getLocationById(window.CardArena.GameData, locId);
    const run = window.PokeRun.loadRunState();
    run.location = window.PokeLocations.createLocationSnapshot(loc);
    window.PokeRun.saveRunState(run);
    return run.location;
}"""

# Retypes the node next to "start" so one click opens the encounter we want,
# instead of walking the whole map hunting for one of each type.
RETYPE_NEXT = """(kind) => {
    const run = window.PokeRun.loadRunState();
    const graph = run.area.graph;
    const edge = graph.edges.find(e => e.from === 'start' || e.to === 'start');
    const nextId = edge.from === 'start' ? edge.to : edge.from;
    graph.nodes.find(n => n.id === nextId).type = kind;
    run.area.currentNodeId = 'start';
    run.area.visitedNodeIds = ['start'];
    window.PokeRun.saveRunState(run);
    return nextId;
}"""

# Runs before navigation, so it goes at localStorage directly rather than
# through PokeRun: a page with an active encounter redirects away from the map.
CLEAR_ACTIVE = """() => {
    const run = JSON.parse(localStorage.getItem('%s'));
    run.area.activeAttackNodeId = null;
    run.area.activeBattleNodeId = null;
    run.area.activeCaptureNodeId = null;
    run.area.activeEventNodeId = null;
    run.area.activeMartNodeId = null;
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)

SHELL_PROBE = """(prefix) => {
    const resolve = %s;
    const bar = document.querySelector('.' + prefix + '-topbar');
    if (!bar) return null;
    const cs = getComputedStyle(bar);
    const title = bar.querySelector('h1');
    const kicker = bar.querySelector('.' + prefix + '-kicker');
    const body = getComputedStyle(document.body);
    return {
        image: cs.backgroundImage,
        bandWidth: parseFloat(cs.borderBottomWidth),
        band: resolve(cs.borderBottomColor),
        title: title ? resolve(getComputedStyle(title).color) : null,
        kicker: kicker ? resolve(getComputedStyle(kicker).color) : null,
        // The gradient's darkest stop: what the header text actually sits on.
        face: resolve(body.getPropertyValue('--pb-shell-face')),
    };
}""" % RESOLVER

OVERFLOW_PROBE = """(() => {
    const de = document.documentElement;
    return { scrollW: de.scrollWidth, clientW: de.clientWidth,
             overflows: de.scrollWidth > de.clientWidth + 1 };
})()"""

BALL_PROBE = """(() => {
    const resolve = %s;
    const ball = document.querySelector('.area-icon--capture');
    if (!ball) return null;
    const cs = getComputedStyle(ball);
    return {
        image: cs.backgroundImage,
        ring: resolve(cs.borderTopColor),
        button: resolve(getComputedStyle(ball, '::after').backgroundColor),
    };
})()""" % RESOLVER

BATTLE_PROBE = """(() => {
    const resolve = %s;
    const rival = getComputedStyle(document.querySelector('.side-panel--opponent'));
    const you = getComputedStyle(document.querySelector('.side-panel--player'));
    const band = getComputedStyle(document.querySelector('.arena-status'));
    return {
        rivalEdge: resolve(rival.borderTopColor),
        rivalImage: rival.backgroundImage,
        bandWidth: parseFloat(rival.borderBottomWidth),
        bandColor: resolve(rival.borderBottomColor),
        youEdge: resolve(you.borderTopColor),
        turnBoxEdge: resolve(band.borderTopColor),
    };
})()""" % RESOLVER

EDITOR_PROBE = """(() => {
    const resolve = %s;
    const header = getComputedStyle(document.querySelector('.editor-header'));
    const tab = document.querySelector('.editor-tab.is-active');
    const save = document.querySelector('.editor-btn--primary');
    return {
        headerImage: header.backgroundImage,
        bandWidth: parseFloat(header.borderBottomWidth),
        band: resolve(header.borderBottomColor),
        title: resolve(getComputedStyle(document.querySelector('.editor-title')).color),
        tabBg: tab ? resolve(getComputedStyle(tab).backgroundColor) : null,
        tabColor: tab ? resolve(getComputedStyle(tab).color) : null,
        saveBg: save ? resolve(getComputedStyle(save).backgroundColor) : null,
    };
})()""" % RESOLVER


def hex_to_css_rgb(value):
    """'#17b300' -> 'rgb(23, 179, 0)', the form a gradient serialises to."""
    raw = value.strip().lstrip("#")
    return "rgb(%d, %d, %d)" % tuple(int(raw[i:i + 2], 16) for i in (0, 2, 4))


def luminance(rgb):
    """Relative luminance of an [r, g, b] triple, per WCAG."""
    chan = []
    for value in rgb:
        c = value / 255
        chan.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2]


def contrast(fg, bg):
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def collect_console(errors, msg):
    """Console errors, minus the ones the theme cannot be blamed for.

    Several locations name a background PNG that is not in the repo yet, so
    every run page logs a 404 for it and falls back to the gradient. That is a
    missing asset, not a styling regression.
    """
    if msg.type != "error":
        return
    if "404" in msg.text and "assets/backgrounds/" in (msg.location.get("url") or ""):
        return
    errors.append(f"console.error: {msg.text}")


def wait_for_run(page):
    page.wait_for_function(
        "window.CardArena && window.CardArena.GameData && window.PokeRun && "
        f"localStorage.getItem('{RUN_KEY}')",
        timeout=15000,
    )


def check_overflow(page, errors, label):
    flow = page.evaluate(OVERFLOW_PROBE)
    if flow["overflows"]:
        errors.append(
            f"{label}: horizontal scroll ({flow['scrollW']} > {flow['clientW']})"
        )


def check_shell(errors, label, shell, accent_css):
    """A shell panel is the location's colour, banded in ink, and readable."""
    if shell is None:
        errors.append(f"{label}: no topbar rendered")
        return
    if accent_css not in shell["image"]:
        errors.append(
            f"{label}: shell is not built from {accent_css}"
            f" (got {shell['image'][:110]})"
        )
    if shell["bandWidth"] < 6:
        errors.append(f"{label}: band is only {shell['bandWidth']}px")
    if shell["band"] != INK:
        errors.append(f"{label}: band is {shell['band']}, expected ink")
    for name in ("title", "kicker"):
        value = shell[name]
        if value is None:
            continue
        ratio = contrast(value, shell["face"])
        if ratio < 4.5:
            errors.append(
                f"{label}: {name} {value} on {shell['face']} is {ratio:.2f}:1"
            )


def run_pages(browser, base_url, errors, width, height, tag, shoot=False):
    """Drives every run page at one viewport. `shoot` writes the screenshots;
    only one pass sets it, so the committed set stays small."""
    page = browser.new_page(viewport={"width": width, "height": height})
    page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
    page.on("console", lambda msg: collect_console(errors, msg))

    shells = {}

    for loc_id in LOCATIONS:
        # Clear from index.html: area.html would redirect to a leftover
        # encounter mid-navigation.
        page.goto(f"{base_url}/index.html")
        page.evaluate("localStorage.clear()")
        page.goto(f"{base_url}/area.html?newRun=1&starter=water")
        wait_for_run(page)
        forced = page.evaluate(FORCE_LOCATION, loc_id)
        accent_css = hex_to_css_rgb(forced["theme"]["accent"])
        page.reload()
        page.wait_for_selector(".area-topbar", timeout=15000)

        label = f"{tag}/{loc_id}/area"
        check_overflow(page, errors, label)
        shell = page.evaluate(SHELL_PROBE, "area")
        print(f"[{label}] band={shell and shell['bandWidth']} face={shell and shell['face']}")
        check_shell(errors, label, shell, accent_css)
        shells.setdefault("area", []).append(shell["image"] if shell else None)

        ball = page.evaluate(BALL_PROBE)
        if ball is None:
            errors.append(f"{label}: no wild-encounter node on the map")
        else:
            if accent_css not in ball["image"]:
                errors.append(
                    f"{label}: node ball is not the location accent"
                    f" ({ball['image'][:110]})"
                )
            if ball["ring"] != INK:
                errors.append(f"{label}: node ball ring is {ball['ring']}")
            if contrast(ball["button"], INK) < 7:
                errors.append(f"{label}: node ball centre button is {ball['button']}")
        if shoot:
            page.screenshot(path=str(HERE / f"pokeball_run_area_{loc_id}.png"))

        for kind, url, selector in ENCOUNTERS:
            page.evaluate(CLEAR_ACTIVE)
            page.goto(f"{base_url}/area.html")
            page.wait_for_selector("[data-node-id]", timeout=15000)
            node_id = page.evaluate(RETYPE_NEXT, kind)
            page.reload()
            page.wait_for_selector(f"[data-node-id='{node_id}']", timeout=15000)
            page.click(f"[data-node-id='{node_id}']")
            page.wait_for_selector(selector, timeout=15000)

            label = f"{tag}/{loc_id}/{kind}"
            if not page.url.endswith(url):
                errors.append(f"{label}: landed on {page.url}")
                continue

            check_overflow(page, errors, label)
            prefix = url.replace(".html", "")
            shell = page.evaluate(SHELL_PROBE, prefix)
            check_shell(errors, label, shell, accent_css)
            shells.setdefault(kind, []).append(shell["image"] if shell else None)
            # One location is enough for the encounter pages: they all share
            # the same shell component, and the area map above already shows
            # the colour following the location.
            if shoot and loc_id == LOCATIONS[-1]:
                page.screenshot(path=str(HERE / f"pokeball_run_{prefix}.png"))

        # The battle board inherits the run's location.
        page.evaluate(CLEAR_ACTIVE)
        page.goto(f"{base_url}/game.html")
        wait_for_player_turn(page, timeout=40)
        page.wait_for_timeout(300)

        label = f"{tag}/{loc_id}/battle"
        check_overflow(page, errors, label)
        battle = page.evaluate(BATTLE_PROBE)
        print(f"[{label}] {battle['rivalEdge']} band={battle['bandWidth']}")
        # The rival half's fill is entirely color-mix()es of the accent, with
        # no raw stop to match on, so it is compared across locations instead
        # (below) and only its edge is matched against the accent here.
        shells.setdefault("battle", []).append(battle["rivalImage"])
        if battle["rivalEdge"] != [int(x) for x in accent_css[4:-1].split(", ")]:
            errors.append(f"{label}: rival edge is {battle['rivalEdge']}, want {accent_css}")
        if battle["bandWidth"] < 6 or battle["bandColor"] != INK:
            errors.append(
                f"{label}: band between the halves is"
                f" {battle['bandWidth']}px {battle['bandColor']}"
            )
        if battle["youEdge"] != STEEL:
            errors.append(f"{label}: your half's edge is {battle['youEdge']}, want steel")
        if battle["turnBoxEdge"] != [int(x) for x in accent_css[4:-1].split(", ")]:
            errors.append(f"{label}: turn box edge is {battle['turnBoxEdge']}")
        if shoot:
            page.screenshot(path=str(HERE / f"pokeball_run_battle_{loc_id}.png"))

    for kind, images in shells.items():
        if len(images) == 2 and images[0] == images[1]:
            errors.append(f"{tag}/{kind}: both locations render the same shell")

    page.close()


def check_editor(errors):
    with serving_editor() as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
        page.goto(f"{base_url}/")
        page.wait_for_selector(".editor-tab.is-active", timeout=15000)
        page.wait_for_selector("table.editor-table tbody tr.editor-row", timeout=15000)
        page.wait_for_timeout(200)

        probe = page.evaluate(EDITOR_PROBE)
        print(f"[editor] {probe}")
        if hex_to_css_rgb("#e3350d") not in probe["headerImage"]:
            errors.append(
                f"editor: header is not the ball's red ({probe['headerImage'][:110]})"
            )
        if probe["bandWidth"] < 6 or probe["band"] != INK_LIGHT:
            errors.append(
                f"editor: header band is {probe['bandWidth']}px {probe['band']}"
            )
        if contrast(probe["title"], PB_RED) < 3:
            errors.append("editor: title contrast on the red shell is too low")
        if probe["tabBg"] != WHITE:
            errors.append(f"editor: active tab is {probe['tabBg']}, expected off-white")
        if contrast(probe["tabColor"], probe["tabBg"]) < 7:
            errors.append("editor: active tab text contrast too low")
        if probe["saveBg"] != PB_RED:
            errors.append(f"editor: primary button is {probe['saveBg']}")
        page.screenshot(path=str(HERE / "pokeball_run_editor.png"))
        browser.close()


def main():
    errors = []

    with serving() as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        run_pages(browser, base_url, errors, 1440, 900, "desktop_1440", shoot=True)
        run_pages(browser, base_url, errors, 390, 844, "phone_390")
        browser.close()

    check_editor(errors)

    if errors:
        print("\nFAIL")
        for line in errors:
            print(" -", line)
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
