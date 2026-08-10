"""Verifies the Poke Ball colour scheme on the pages that use it.

Screenshots home / starter / overview / achievements / 404 at phone, tablet and
desktop viewports and asserts the layout survives every size:

  * no page scrolls horizontally, and no panel spills out of the viewport;
  * the home panel (the ball's centre button) stays centred on the ball's band,
    has a white face with dark text, and goes circular only where it fits;
  * the starter page's heading sits on the red strip and its deck cards are
    light plates with dark text.

Usage: .cache/venv/bin/python pokeball_theme.py
"""

import sys

from lib import serving, sync_playwright

VIEWPORTS = [
    ("phone_320", 320, 640),
    ("phone_390", 390, 844),
    ("tablet_768", 768, 1024),
    ("short_1280", 1280, 620),
    ("desktop_1440", 1440, 900),
]

PAGES = ["index.html", "starter.html", "overview.html", "achievements.html", "404.html"]

RED = "rgb(227, 53, 13)"
INK = "rgb(36, 39, 44)"
WHITE = "rgb(255, 255, 255)"


def luminance(rgb):
    """Relative luminance of an 'rgb(r, g, b)' string, per WCAG."""
    parts = [int(p) for p in rgb.strip("rgba()").split(",")[:3]]
    chan = []
    for value in parts:
        c = value / 255
        chan.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2]


def contrast(fg, bg):
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


# getComputedStyle returns unregistered custom properties unresolved (the raw
# `clamp(...)` text), so a length token is measured by handing it to a real
# layout property instead.
MEASURE_TOKEN = """(token => {
    const probe = document.createElement('div');
    probe.style.cssText =
        `position:absolute;visibility:hidden;height:0;width:var(${token})`;
    document.body.appendChild(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
})"""


def overflow_probe(page):
    return page.evaluate(
        """(() => {
            const de = document.documentElement;
            return {
                scrollW: de.scrollWidth,
                clientW: de.clientWidth,
                overflows: de.scrollWidth > de.clientWidth + 1,
            };
        })()"""
    )


def home_probe(page):
    return page.evaluate(
        """(() => {
            const measure = """ + MEASURE_TOKEN + """;
            const panel = document.querySelector('.main-menu');
            const cs = getComputedStyle(panel);
            const r = panel.getBoundingClientRect();
            const body = document.body.getBoundingClientRect();
            const band = measure('--pb-band');
            const buttons = [...document.querySelectorAll('.main-menu .btn')];
            return {
                panelTop: Math.round(r.top),
                panelBottom: Math.round(r.bottom),
                panelW: Math.round(r.width),
                panelH: Math.round(r.height),
                panelCenterY: Math.round(r.top + r.height / 2 + window.scrollY),
                bodyCenterY: Math.round(body.height / 2),
                bodyH: Math.round(body.height),
                viewportH: window.innerHeight,
                band: band,
                bg: cs.backgroundColor,
                color: cs.color,
                radius: cs.borderRadius,
                circular: cs.borderRadius.includes('50%')
                    || Math.abs(r.width - r.height) < 2
                        && parseFloat(cs.borderTopLeftRadius) >= r.width / 2 - 2,
                borderColor: cs.borderTopColor,
                // Every button must sit inside the panel's content box.
                buttonsInside: buttons.every(b => {
                    const bb = b.getBoundingClientRect();
                    return bb.left >= r.left - 1 && bb.right <= r.right + 1
                        && bb.top >= r.top - 1 && bb.bottom <= r.bottom + 1;
                }),
                buttonBg: buttons.length ? getComputedStyle(buttons[0]).backgroundColor : null,
                buttonColor: buttons.length ? getComputedStyle(buttons[0]).color : null,
            };
        })()"""
    )


def starter_probe(page):
    return page.evaluate(
        """(() => {
            const measure = """ + MEASURE_TOKEN + """;
            const h1 = document.querySelector('.starter-shell h1');
            const card = document.querySelector('.starter-card');
            const header = measure('--pb-header');
            const hr = h1.getBoundingClientRect();
            return {
                headerStrip: header,
                band: measure('--pb-band'),
                headingBottom: Math.round(hr.bottom + window.scrollY),
                cardTop: card
                    ? Math.round(card.getBoundingClientRect().top + window.scrollY)
                    : null,
                headingColor: getComputedStyle(h1).color,
                cardBg: card ? getComputedStyle(card).backgroundColor : null,
                cardColor: card ? getComputedStyle(card).color : null,
                ctaBg: (() => {
                    const cta = document.querySelector('.starter-card-cta');
                    return cta ? getComputedStyle(cta).backgroundColor : null;
                })(),
                cards: document.querySelectorAll('.starter-card').length,
            };
        })()"""
    )


def main():
    errors = []

    with serving() as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for name, width, height in VIEWPORTS:
            page = browser.new_page(viewport={"width": width, "height": height})
            page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
            page.on(
                "console",
                lambda msg: errors.append(f"console.error: {msg.text}")
                if msg.type == "error"
                else None,
            )

            for path in PAGES:
                page.goto(f"{base_url}/{path}")
                if path == "starter.html":
                    page.wait_for_selector(".starter-card", timeout=15000)
                page.wait_for_timeout(150)

                flow = overflow_probe(page)
                if flow["overflows"]:
                    errors.append(
                        f"{name}/{path}: horizontal scroll"
                        f" ({flow['scrollW']} > {flow['clientW']})"
                    )

                if path in ("index.html", "404.html"):
                    home = home_probe(page)
                    print(f"[{name}/{path}] {home}")
                    off = abs(home["panelCenterY"] - home["bodyCenterY"])
                    if off > 4:
                        errors.append(
                            f"{name}/{path}: panel is {off}px off the ball's band"
                        )
                    if home["bg"] != WHITE:
                        errors.append(f"{name}/{path}: panel face is {home['bg']}")
                    if home["color"] != INK:
                        errors.append(f"{name}/{path}: panel text is {home['color']}")
                    if home["borderColor"] != INK:
                        errors.append(f"{name}/{path}: panel ring is {home['borderColor']}")
                    if contrast(home["color"], home["bg"]) < 7:
                        errors.append(f"{name}/{path}: panel text contrast too low")
                    if not home["buttonsInside"]:
                        errors.append(f"{name}/{path}: a button spills out of the panel")
                    if home["buttonBg"] != RED:
                        errors.append(f"{name}/{path}: button is {home['buttonBg']}")
                    if contrast(home["buttonColor"], home["buttonBg"]) < 3:
                        errors.append(f"{name}/{path}: button label contrast too low")
                    if home["panelH"] > home["viewportH"]:
                        errors.append(
                            f"{name}/{path}: panel ({home['panelH']}px) is taller"
                            f" than the viewport ({home['viewportH']}px)"
                        )
                    # The circle only makes sense where there is room for it.
                    roomy = width >= 620 and height >= 700
                    if roomy != home["circular"]:
                        errors.append(
                            f"{name}/{path}: circular={home['circular']} at"
                            f" {width}x{height} (expected {roomy})"
                        )

                if path == "starter.html":
                    st = starter_probe(page)
                    print(f"[{name}/{path}] {st}")
                    if st["cards"] < 1:
                        errors.append(f"{name}/{path}: no starter cards rendered")
                    # The heading is stretched to fill the strip, so its bottom
                    # should land on the strip's edge, never past it.
                    if st["headingBottom"] > st["headerStrip"] + 1:
                        errors.append(
                            f"{name}/{path}: heading ({st['headingBottom']}px) runs past"
                            f" the red strip ({st['headerStrip']}px)"
                        )
                    band_bottom = st["headerStrip"] + st["band"]
                    if st["cardTop"] is not None and st["cardTop"] < band_bottom:
                        errors.append(
                            f"{name}/{path}: deck row starts at {st['cardTop']}px,"
                            f" inside the band (ends {round(band_bottom)}px)"
                        )
                    if st["cardBg"] != WHITE:
                        errors.append(f"{name}/{path}: deck card face is {st['cardBg']}")
                    if contrast(st["cardColor"], st["cardBg"]) < 7:
                        errors.append(f"{name}/{path}: deck card text contrast too low")
                    if contrast(st["headingColor"], RED) < 3:
                        errors.append(f"{name}/{path}: heading contrast on red too low")
                    if st["ctaBg"] != RED:
                        errors.append(f"{name}/{path}: deck CTA is {st['ctaBg']}")

                stem = path.replace(".html", "")
                page.screenshot(path=f"pokeball_{stem}_{name}.png")

            page.close()

        browser.close()

    if errors:
        print("\nFAIL")
        for line in errors:
            print(" -", line)
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
