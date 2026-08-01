"""Phase 82 verification: authoring the locationTypes flag in the data editor.

Spawns `node dev/editor/server.js` on port 8933 (same pattern as
drive_editor.py / phase74_editor_conditions.py), opens the Events tab, selects
nursery-egg, and confirms the "Match this location's types" checkbox on its
gain-random-baby effect renders checked (events.json already carries
locationTypes:true on that effect). Toggling the checkbox off and back on and
saving must reproduce the exact same file bytes -- proof the editor's
structuredClone-draft round trip stays byte-exact. Compares against the
working-tree file as found (not `git diff` against HEAD), since phase 82's own
data edit -- adding locationTypes:true to nursery-egg -- is itself an
uncommitted, intentional change at the time this driver runs.

events.json is restored to its pre-run content before exit either way.

Usage: .cache/venv/bin/python phase82_editor_location_types.py [screenshot.png]
Exits non-zero on any page error or failed assertion.
"""

import sys
from pathlib import Path

from drive_editor import ROOT, serving_editor

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
EVENT_ID = "nursery-egg"
CHECKBOX = '[data-scope="eff-location-types"][data-owner="gift"][data-index="0"]'
EVENTS_JSON = ROOT / "events.json"

PANEL = ".editor-tab-panel:not([hidden])"
ROWS = f"{PANEL} table.editor-table tbody tr.editor-row"


def open_event(page, event_id):
    page.click(f'{PANEL} tr.editor-row[data-key="{event_id}"]')
    page.wait_for_selector(".editor-events-form", timeout=15000)


def save(page):
    page.click('[data-action="save"]')
    page.wait_for_function(
        "() => !document.querySelector('[data-action=\"save\"]')"
        " || !document.querySelector('[data-action=\"save\"]').disabled",
        timeout=15000,
    )
    page.wait_for_timeout(300)


def main():
    screenshot_path = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "phase82_editor_location_types.png")

    baseline = EVENTS_JSON.read_text()

    errors = []
    failure = None

    with serving_editor() as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1500, "height": 1100})
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
        page.on(
            "console",
            lambda msg: errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
        )

        try:
            page.goto(f"{base_url}/")
            page.wait_for_selector('#editor-tabs .editor-tab[data-tab="events"]', timeout=15000)
            page.click('#editor-tabs .editor-tab[data-tab="events"]')
            page.wait_for_selector(ROWS, timeout=15000)

            open_event(page, EVENT_ID)
            page.wait_for_selector(CHECKBOX, timeout=15000)
            checked = page.is_checked(CHECKBOX)
            assert checked, f"expected {EVENT_ID}'s gain-random-baby locationTypes checkbox to render checked"
            print(f"OK: {EVENT_ID} locationTypes checkbox renders checked")

            page.screenshot(path=screenshot_path, full_page=True)
            print(f"screenshot: {screenshot_path}")

            # Toggle off, then back on, then save -- must be an empty diff.
            page.click(CHECKBOX)
            page.wait_for_timeout(200)
            assert not page.is_checked(CHECKBOX), "checkbox did not uncheck"
            page.click(CHECKBOX)
            page.wait_for_timeout(200)
            assert page.is_checked(CHECKBOX), "checkbox did not re-check"

            save(page)
            after = EVENTS_JSON.read_text()
            assert after == baseline, "toggling the checkbox off and back on and saving changed events.json bytes"
            print("OK: toggling the checkbox off and back on and saving leaves events.json byte-identical")
        except Exception as exc:  # noqa: BLE001 - report, restore, exit non-zero below
            failure = f"{type(exc).__name__}: {exc}"
        finally:
            EVENTS_JSON.write_text(baseline)
            browser.close()

    if failure:
        print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1

    print("OK: locationTypes checkbox renders checked and round-trips byte-exact")
    return 0


if __name__ == "__main__":
    sys.exit(main())
