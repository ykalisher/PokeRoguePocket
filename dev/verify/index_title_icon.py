"""Screenshots the home page title/icon row at phone and desktop widths.

Also checks the favicon/manifest links resolve and that the random title icon
lands on more than one image across reloads.
"""

import sys
from collections import Counter

from lib import BASE_URL, serving, sync_playwright

VIEWPORTS = [
    ("phone_320", 320, 640),
    ("phone_390", 390, 780),
    ("tablet_768", 768, 1024),
    ("desktop_1440", 1440, 900),
]


def main():
    errors = []
    picks = Counter()

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
            page.goto(f"{base_url}/index.html")
            page.wait_for_selector(".menu-title-icon")

            box = page.evaluate(
                """(() => {
                    const icon = document.querySelector('.menu-title-icon');
                    const span = document.querySelector('.menu-title span');
                    const title = document.querySelector('.menu-title');
                    const panel = document.querySelector('.main-menu');
                    const i = icon.getBoundingClientRect();
                    const s = span.getBoundingClientRect();
                    return {
                        src: icon.getAttribute('src'),
                        naturalWidth: icon.naturalWidth,
                        iconH: Math.round(i.height * 10) / 10,
                        iconTop: Math.round(i.top),
                        iconBottom: Math.round(i.bottom),
                        spanH: Math.round(s.height * 10) / 10,
                        spanTop: Math.round(s.top),
                        iconLeftOfText: i.right <= s.left + 1,
                        sameRow: i.top < s.bottom && s.top < i.bottom,
                        // The span is a flex item, so it is blockified and its
                        // own rect is one box however the text wraps; range
                        // rects expose the real line boxes.
                        lines: (() => {
                            const r = document.createRange();
                            r.selectNodeContents(span);
                            return r.getClientRects().length;
                        })(),
                        fitsPanel: s.right <= panel.getBoundingClientRect().right,
                        fontSize: getComputedStyle(title).fontSize,
                        transform: getComputedStyle(title).textTransform,
                        text: span.textContent,
                        titleW: Math.round(title.getBoundingClientRect().width),
                        panelW: Math.round(panel.getBoundingClientRect().width),
                        overflows: document.documentElement.scrollWidth >
                            document.documentElement.clientWidth,
                    };
                })()"""
            )
            print(f"[{name}] {box}")

            if box["naturalWidth"] == 0:
                errors.append(f"{name}: title icon failed to load ({box['src']})")
            if not box["iconLeftOfText"]:
                errors.append(f"{name}: icon is not left of the title text")
            if not box["sameRow"]:
                errors.append(f"{name}: icon and text are not on the same row")
            if box["transform"] != "none":
                errors.append(f"{name}: title is still text-transformed")
            if box["text"] != "Pocket Nuzlocke":
                errors.append(f"{name}: unexpected title text {box['text']!r}")
            if box["overflows"]:
                errors.append(f"{name}: page scrolls horizontally")
            if not box["fitsPanel"]:
                errors.append(f"{name}: title text spills past the menu panel")
            if box["iconH"] < box["spanH"]:
                errors.append(
                    f"{name}: icon ({box['iconH']}px) is shorter than the title"
                    f" text block ({box['spanH']}px)"
                )

            page.screenshot(path=f"index_title_{name}.png")
            page.close()

        # Favicon + manifest + PWA icons must all be fetchable.
        page = browser.new_page()
        page.goto(f"{base_url}/index.html")
        for path in [
            "assets/icons/nuzlocke-icon.png",
            "assets/icons/nuzlocke-icon-200.png",
            "assets/icons/nuzlocke-icon-520.png",
            "manifest.webmanifest",
        ]:
            status = page.evaluate(
                "p => fetch(p).then(r => r.status)", f"{base_url}/{path}"
            )
            print(f"GET {path} -> {status}")
            if status != 200:
                errors.append(f"{path} returned {status}")

        for _ in range(30):
            page.goto(f"{base_url}/index.html")
            picks[page.get_attribute(".menu-title-icon", "src")] += 1
        print("random picks:", dict(picks))
        if len(picks) < 2:
            errors.append("title icon never varied across 30 loads")

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
