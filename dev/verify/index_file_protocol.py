"""Loads index.html over file:// and reports console/page errors.

The manifest link is same-origin over http but not over file://; this checks the
home page still boots cleanly when opened straight off disk.
"""

import sys

from lib import ROOT, sync_playwright


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
        page.on(
            "console",
            lambda msg: errors.append(f"console.{msg.type}: {msg.text}")
            if msg.type in ("error", "warning")
            else None,
        )
        page.goto((ROOT / "index.html").as_uri())
        page.wait_for_selector(".menu-title-icon")
        info = page.evaluate(
            """(() => {
                const icon = document.querySelector('.menu-title-icon');
                return { src: icon.getAttribute('src'), loaded: icon.naturalWidth > 0 };
            })()"""
        )
        print("file:// title icon:", info)
        if not info["loaded"]:
            errors.append("title icon did not load over file://")
        page.screenshot(path="index_title_file_protocol.png")
        browser.close()

    print("console/page messages:", errors or "none")
    hard = [e for e in errors if not e.startswith("console.warning")]
    if not info["loaded"] or hard:
        print("FAIL")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
