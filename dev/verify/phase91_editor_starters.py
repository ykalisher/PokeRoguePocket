"""Phase 91 verification: the Starters tab in the data editor.

Spawns `node dev/editor/server.js` on port 8933 (same pattern as
drive_editor.py / phase82_editor_location_types.py) and drives the new
Starters tab end to end: list view (portraits, type icon, P/A/I totals,
enabled dots), the water deck's preview (mirrors starter.html), the
attack/item +/- steppers (including remove-at-1), the picker, the
starterDecks.bad-id / bad-type issue-box + save-refused path, adding a
fourth deck and confirming it renders on starter.html (served separately on
8931 via lib.serving()), and the starterDecks.none-enabled delete guard.

starter_decks.json is restored via `git checkout` before exit either way.

Usage: .cache/venv/bin/python phase91_editor_starters.py [screenshot.png]
Exits non-zero on any page error or failed assertion.
"""

import json
import sys
from pathlib import Path

from drive_editor import ROOT, git_clean, git_restore, serving_editor

from lib import serving
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DATA = ROOT / "starter_decks.json"

PANEL = ".editor-tab-panel:not([hidden])"
ROWS = f"{PANEL} table.editor-table tbody tr.editor-row"


def open_deck(page, deck_id):
    page.click(f'{ROWS}[data-key="{deck_id}"]')
    page.wait_for_selector(".editor-trainer-preview", timeout=15000)


def back_to_list(page):
    page.click('[data-action="back"]')
    page.wait_for_selector(ROWS, timeout=15000)


def save(page):
    page.click('[data-action="save"]')
    page.wait_for_timeout(400)


def main():
    screenshot_path = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "phase91_editor_starters.png")

    if not git_clean("starter_decks.json"):
        print("FAIL: starter_decks.json has uncommitted changes before the smoke test even starts", file=sys.stderr)
        return 1

    baseline = DATA.read_text()
    errors = []
    failure = None

    with serving_editor() as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1500, "height": 1200})
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
        page.on(
            "console",
            # "Failed to load resource" fires for every intentional 409 this driver
            # triggers (save-blocked, delete-blocked) -- expected noise, not a bug.
            lambda msg: errors.append(f"console.error: {msg.text}")
            if msg.type == "error" and "Failed to load resource" not in msg.text else None,
        )

        try:
            page.goto(f"{base_url}/")
            page.wait_for_selector('#editor-tabs .editor-tab[data-tab="starters"]', timeout=15000)
            page.click('#editor-tabs .editor-tab[data-tab="starters"]')
            page.wait_for_selector(ROWS, timeout=15000)

            # --- 1. list view: 3 decks, portraits, type icon, P/A/I, enabled dots ---
            rows = page.query_selector_all(ROWS)
            keys = [r.get_attribute("data-key") for r in rows]
            assert sorted(keys) == ["fire", "grass", "water"], f"expected 3 decks, found {keys}"

            water_row = page.query_selector(f'{ROWS}[data-key="water"]')
            cells = water_row.query_selector_all("td")
            assert len(water_row.query_selector_all("td:nth-child(1) img")) == 2, "expected 2 portrait thumbs for water"
            assert cells[3].query_selector("img.type-icon") is not None, "expected a type icon in the type column"
            assert cells[4].text_content().strip() == "2 / 6 / 2", f"expected P/A/I '2 / 6 / 2', got {cells[4].text_content()!r}"
            assert "editor-dot--on" in cells[5].inner_html(), "expected water's enabled dot to render on"
            print(f"OK: list view shows {sorted(keys)}, water portraits/type-icon/P-A-I/enabled all correct")

            # --- 2. open water: preview mirrors starter.html ---
            open_deck(page, "water")
            preview_text = page.text_content(".editor-trainer-preview")
            assert "WATER" in preview_text, "expected the WATER type badge in the preview"
            for name in ("Blastoise", "Feraligatr"):
                assert name in preview_text, f"expected {name} portrait/name in the preview"
            for line in ("2× Surf", "2× Waterfall", "1× Crunch", "1× Sucker Punch", "1× Sitrus Berry", "1× Withdraw Wand"):
                assert line in preview_text, f"expected {line!r} in the preview card list"
            print("OK: water's preview matches starter.html content (type, portraits, card list)")

            page.screenshot(path=screenshot_path)
            print(f"screenshot: {screenshot_path}")

            # --- 3. steppers: Surf 2 -> 3 -> 2, Crunch (count 1) removed by minus ---
            surf_count = '[data-deck-rows="attacks"] li:has-text("Surf") .editor-stepper-count'
            surf_plus = '[data-deck-rows="attacks"] li:has-text("Surf") [data-stepper="plus"]'
            surf_minus = '[data-deck-rows="attacks"] li:has-text("Surf") [data-stepper="minus"]'
            assert page.text_content(surf_count).strip() == "2"
            page.click(surf_plus)
            assert page.text_content(surf_count).strip() == "3", "Surf did not go 2 -> 3"
            page.click(surf_minus)
            assert page.text_content(surf_count).strip() == "2", "Surf did not go 3 -> 2"

            crunch_row = '[data-deck-rows="attacks"] li:has-text("Crunch")'
            page.wait_for_selector(crunch_row, timeout=5000)
            page.click(f'{crunch_row} [data-stepper="minus"]')
            page.wait_for_timeout(150)
            assert page.query_selector(crunch_row) is None, "Crunch (count 1) should be removed by one minus click"
            print("OK: attack steppers move counts and remove-at-1 works")

            # --- 4. picker adds a new attack at count 1 ---
            page.fill('[data-picker="attacks"] .editor-picker-input', "Sleep Powder")
            page.wait_for_selector('[data-picker="attacks"] .editor-picker-results li', timeout=5000)
            page.click('[data-picker="attacks"] .editor-picker-results li:has-text("Sleep Powder")')
            sleep_powder_row = '[data-deck-rows="attacks"] li:has-text("Sleep Powder")'
            page.wait_for_selector(sleep_powder_row, timeout=5000)
            assert page.text_content(f"{sleep_powder_row} .editor-stepper-count").strip() == "1"
            print("OK: picker adds a new attack at count 1")

            # Discard this dirty draft (the Sleep Powder add) without saving.
            page.once("dialog", lambda dialog: dialog.accept())
            back_to_list(page)

            # --- 5. nonsense id/type surfaces the phase-90 error, Save refused ---
            open_deck(page, "water")
            page.fill('input[name="id"]', "not a valid id!!")
            page.wait_for_selector("#editor-form-issues:not([hidden])", timeout=5000)
            issues_text = page.text_content("#editor-form-issues")
            assert "starterDecks.bad-id" in issues_text, f"expected starterDecks.bad-id in the issue box, got: {issues_text}"
            print("OK: an invalid id surfaces starterDecks.bad-id in the form issue box")

            page.click('[data-action="save"]')
            page.wait_for_selector(".editor-modal-title", timeout=10000)
            modal_title = page.text_content(".editor-modal-title")
            modal_body = page.text_content(".editor-modal")
            assert "Save blocked" in modal_title, f"expected a 'Save blocked' modal, got {modal_title!r}"
            assert "starterDecks.bad-id" in modal_body
            page.click('[data-action="close-modal"]')
            print("OK: saving an invalid id is refused with a 'Save blocked' dialog")

            after_bad_save = DATA.read_text()
            assert after_bad_save == baseline, "a refused save must not touch starter_decks.json"

            # --- back out without saving the dirty (invalid) draft ---
            page.once("dialog", lambda dialog: dialog.accept())
            back_to_list(page)

            # --- 6. round trip: bump Surf to 3 and save -> diff is exactly that count ---
            open_deck(page, "water")
            page.click(surf_plus)
            assert page.text_content(surf_count).strip() == "3"
            save(page)
            bumped = json.loads(DATA.read_text())
            water = next(d for d in bumped if d["id"] == "water")
            surf_entry = next(e for e in water["attacks"] if e["name"] == "Surf")
            assert surf_entry["count"] == 3, f"expected Surf count 3 after save, got {surf_entry['count']}"
            print("OK: bumping Surf to 3 and saving round-trips as exactly that one count change")

            git_restore("starter_decks.json")
            assert DATA.read_text() == baseline, "git checkout should have restored starter_decks.json"

            # git checkout only touches disk -- the browser's in-memory store
            # still has Surf=3 from the save above, so re-fetch before any
            # further save would re-write that stale count back to disk.
            page.goto(f"{base_url}/")
            page.wait_for_selector('#editor-tabs .editor-tab[data-tab="starters"]', timeout=15000)
            page.click('#editor-tabs .editor-tab[data-tab="starters"]')
            page.wait_for_selector(ROWS, timeout=15000)

            # --- 7. locations.starter-coverage: a deck's type needs an enabled location ---
            locations_path = ROOT / "locations.json"
            locations_baseline = locations_path.read_text()
            locs = json.loads(locations_baseline)
            disabled = [loc for loc in locs if loc.get("enabled", True) and "ELECTRIC" in loc.get("types", [])]
            assert disabled, "expected at least one enabled ELECTRIC location to disable for this test"
            for loc in disabled:
                loc["enabled"] = False
            locations_path.write_text(json.dumps(locs, indent=2) + "\n")
            try:
                # Reload so the client's in-memory `locations` also sees the disabled set
                # (the write guard's real verdict comes from the server either way, which
                # always reads the file fresh, but this also exercises the predictive
                # form-issues box).
                page.goto(f"{base_url}/")
                page.wait_for_selector('#editor-tabs .editor-tab[data-tab="starters"]', timeout=15000)
                page.click('#editor-tabs .editor-tab[data-tab="starters"]')
                page.wait_for_selector(ROWS, timeout=15000)

                open_deck(page, "fire")
                page.select_option('select[name="type"]', "ELECTRIC")
                page.wait_for_selector("#editor-form-issues:not([hidden])", timeout=5000)
                issues_text = page.text_content("#editor-form-issues")
                assert "locations.starter-coverage" in issues_text, (
                    f"expected locations.starter-coverage in the issue box, got: {issues_text}"
                )

                page.click('[data-action="save"]')
                page.wait_for_selector(".editor-modal-title", timeout=10000)
                modal_body = page.text_content(".editor-modal")
                assert "locations.starter-coverage" in modal_body
                assert "enable a location with that type" in modal_body, (
                    f"expected the message to name the fix, got: {modal_body}"
                )
                page.click('[data-action="close-modal"]')
                print("OK: a deck typed for a location-less type is refused (locations.starter-coverage) and names the fix")

                after_coverage_save = DATA.read_text()
                assert after_coverage_save == baseline, "a refused save must not touch starter_decks.json"
            finally:
                locations_path.write_text(locations_baseline)

            # Navigating away discards the dirty (unsaved) type change (no beforeunload
            # handler); re-sync from the just-restored locations.json while we're at it.
            page.goto(f"{base_url}/")
            page.wait_for_selector('#editor-tabs .editor-tab[data-tab="starters"]', timeout=15000)
            page.click('#editor-tabs .editor-tab[data-tab="starters"]')
            page.wait_for_selector(ROWS, timeout=15000)

            # --- 8. add a 4th deck, confirm it renders on starter.html, then remove it ---
            page.click('[data-action="add-starter"]')
            page.wait_for_selector(".editor-trainer-preview", timeout=15000)
            page.fill('input[name="id"]', "electric")
            page.fill('input[name="name"]', "Electric")
            page.select_option('select[name="type"]', "ELECTRIC")

            for field, name in (("pokemon", "Manectric"), ("attacks", "Thunder Bolt"), ("items", "Sitrus Berry")):
                page.fill(f'[data-picker="{field}"] .editor-picker-input', name)
                page.wait_for_selector(f'[data-picker="{field}"] .editor-picker-results li', timeout=5000)
                page.click(f'[data-picker="{field}"] .editor-picker-results li:has-text("{name}")')

            save(page)
            after_add = json.loads(DATA.read_text())
            assert len(after_add) == 4 and any(d["id"] == "electric" for d in after_add), "expected a 4th 'electric' deck to be saved"
            print("OK: adding a 4th starter deck saves it to starter_decks.json")

            with serving() as game_base_url:
                game_page = browser.new_page()
                game_page.goto(f"{game_base_url}/starter.html")
                game_page.wait_for_selector(".starter-card", timeout=15000)
                starter_ids = [c.get_attribute("data-starter") for c in game_page.query_selector_all(".starter-card")]
                assert sorted(starter_ids) == ["electric", "fire", "grass", "water"], (
                    f"expected 4 starter cards including 'electric', got {starter_ids}"
                )
                print(f"OK: starter.html (served on 8931) renders all 4 decks: {starter_ids}")
                game_page.close()

            back_to_list(page)
            open_deck(page, "electric")
            page.once("dialog", lambda dialog: dialog.accept())
            page.click('[data-action="delete"]')
            # A successful delete returns straight to the list (no "back" click needed).
            page.wait_for_selector(ROWS, timeout=15000)
            rows = page.query_selector_all(ROWS)
            keys = [r.get_attribute("data-key") for r in rows]
            assert sorted(keys) == ["fire", "grass", "water"], f"expected the fixture deck gone, found {keys}"
            print("OK: the fixture 'electric' deck was deleted, back to the original 3")

            assert DATA.read_text() == baseline, "after adding and deleting the fixture deck, the file should match baseline"

            # --- 9. starterDecks.none-enabled: can't delete the last enabled deck ---
            for deck_id in ("grass", "fire"):
                open_deck(page, deck_id)
                page.uncheck('input[name="enabled"]')
                save(page)
                back_to_list(page)

            open_deck(page, "water")
            page.once("dialog", lambda dialog: dialog.accept())
            page.click('[data-action="delete"]')
            # requestDelete's 409 branch shows the reference dialog (title 'Cannot
            # delete "..."'), and refRow prints the issue's message, not its code.
            page.wait_for_selector(".editor-modal-title", timeout=10000)
            modal_title = page.text_content(".editor-modal-title")
            modal_body = page.text_content(".editor-modal")
            assert 'Cannot delete' in modal_title, f"expected a 'Cannot delete' modal, got {modal_title!r}"
            assert "needs at least one enabled deck" in modal_body, (
                f"expected the starterDecks.none-enabled message to block deleting the last enabled deck, got: {modal_body}"
            )
            page.click('[data-action="close-modal"]')
            print("OK: deleting the last enabled starter deck is refused (starterDecks.none-enabled)")

        except Exception as exc:  # noqa: BLE001 - report, restore, exit non-zero below
            failure = f"{type(exc).__name__}: {exc}"
        finally:
            git_restore("starter_decks.json")
            browser.close()

    if DATA.read_text() != baseline:
        failure = failure or "starter_decks.json was not restored to baseline"

    if failure:
        print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1

    print("OK: Starters tab list, preview, steppers, picker, validation, add/delete and starter.html round trip all verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
