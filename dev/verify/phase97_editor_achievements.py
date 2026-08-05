"""Phase 97 verification: the Achievements tab in the data editor.

Spawns `node dev/editor/server.js` on port 8933 (same pattern as
drive_editor.py / phase91_editor_starters.py) and drives the new
Achievements tab end to end: list view (enabled dot, stat code, hidden
marker), champion's preview (mirrors achievements.html), a byte-clean
round trip, the two-control stat picker switching an exact key to a
family + suffix and back, the achievements.bad-threshold issue-box +
save-refused path, adding a new achievement and confirming it renders on
achievements.html (served separately on 8931 via lib.serving()), and the
delete guard against an event conditioned on an achievement.

achievements.json and events.json are restored via `git checkout` before
exit either way.

Usage: .cache/venv/bin/python phase97_editor_achievements.py [screenshot.png]
Exits non-zero on any page error or failed assertion.
"""

import json
import sys
from pathlib import Path

from drive_editor import ROOT, git_clean, git_restore, serving_editor

from lib import serving
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DATA = ROOT / "achievements.json"
EVENTS_DATA = ROOT / "events.json"

PANEL = ".editor-tab-panel:not([hidden])"
ROWS = f"{PANEL} table.editor-table tbody tr.editor-row"


def open_achievement(page, achievement_id):
    page.click(f'{ROWS}[data-key="{achievement_id}"]')
    page.wait_for_selector(".achievement-row", timeout=15000)


def back_to_list(page):
    page.click('[data-action="back"]')
    page.wait_for_selector(ROWS, timeout=15000)


def save(page):
    page.click('[data-action="save"]')
    page.wait_for_timeout(400)


def goto_achievements_tab(page, base_url):
    page.goto(f"{base_url}/")
    page.wait_for_selector('#editor-tabs .editor-tab[data-tab="achievements"]', timeout=15000)
    page.click('#editor-tabs .editor-tab[data-tab="achievements"]')
    page.wait_for_selector(ROWS, timeout=15000)


def main():
    screenshot_path = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "phase97_editor_achievements.png")

    if not git_clean("achievements.json"):
        print("FAIL: achievements.json has uncommitted changes before the smoke test even starts", file=sys.stderr)
        return 1
    if not git_clean("events.json"):
        print("FAIL: events.json has uncommitted changes before the smoke test even starts", file=sys.stderr)
        return 1

    baseline = DATA.read_text()
    events_baseline = EVENTS_DATA.read_text()
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
            goto_achievements_tab(page, base_url)

            # --- 1. list view: seeded achievements, enabled dots, stat code, hidden marker ---
            rows = page.query_selector_all(ROWS)
            keys = [r.get_attribute("data-key") for r in rows]
            expected = {"first-steps", "first-blood", "gym-challenger", "champion", "blaze-purist", "wanderer"}
            assert expected.issubset(set(keys)), f"expected {expected} among rows, found {keys}"

            gym_row = page.query_selector(f'{ROWS}[data-key="gym-challenger"]')
            cells = gym_row.query_selector_all("td")
            assert "editor-dot--on" in cells[0].inner_html(), "expected gym-challenger's enabled dot to render on"
            assert "battles.won.rank.Boss" in cells[3].text_content(), f"expected the stat code, got {cells[3].text_content()!r}"

            blaze_row = page.query_selector(f'{ROWS}[data-key="blaze-purist"]')
            assert "hidden" in blaze_row.query_selector_all("td")[5].text_content().lower(), "expected a hidden marker on blaze-purist"
            print(f"OK: list view shows {sorted(keys)}, enabled dot/stat code/hidden marker all correct")

            # --- 2. open champion: preview mirrors achievements.html ---
            open_achievement(page, "champion")
            preview_text = page.text_content(".achievement-row")
            assert "Champion" in preview_text, "expected the Champion name in the preview"
            assert "Finish a full run." in preview_text, "expected the description in the preview"
            assert "0 / 1" in preview_text, f"expected '0 / 1' progress in the preview, got: {preview_text!r}"
            print("OK: champion's preview matches achievements.html content (name, description, progress)")

            page.screenshot(path=screenshot_path)
            print(f"screenshot: {screenshot_path}")

            # --- 3. round trip: untouched save -> empty diff ---
            save(page)
            assert DATA.read_text() == baseline, "an untouched save must produce a byte-clean diff"
            print("OK: saving champion untouched round-trips with zero diff")

            back_to_list(page)
            open_achievement(page, "champion")

            # --- 4. round trip: bump atLeast by 1 -> diff is exactly that field ---
            page.fill('input[name="atLeast"]', "2")
            save(page)
            bumped = json.loads(DATA.read_text())
            champion = next(a for a in bumped if a["id"] == "champion")
            assert champion["atLeast"] == 2, f"expected atLeast 2 after save, got {champion['atLeast']}"
            for other in bumped:
                if other["id"] != "champion":
                    baseline_other = next(a for a in json.loads(baseline) if a["id"] == other["id"])
                    assert other == baseline_other, f"expected only champion to change, but {other['id']} differs"
            print("OK: bumping atLeast to 2 and saving round-trips as exactly that one field change")

            git_restore("achievements.json")
            assert DATA.read_text() == baseline, "git checkout should have restored achievements.json"
            goto_achievements_tab(page, base_url)

            # --- 5. stat picker: exact key -> family + suffix, writes the joined string ---
            open_achievement(page, "champion")
            assert page.input_value('select[name="statFamily"]') == "runs.completed", "expected champion's stat picker to start on the exact key runs.completed"
            assert page.query_selector('select[name="statSuffix"], input[name="statSuffix"]') is None, "no suffix control expected for an exact key"

            page.select_option('select[name="statFamily"]', "events.seen.")
            page.wait_for_selector('select[name="statSuffix"]', timeout=5000)
            page.select_option('select[name="statSuffix"]', "sitrus-berry-tree")
            save(page)

            saved = json.loads(DATA.read_text())
            champion = next(a for a in saved if a["id"] == "champion")
            assert champion["stat"] == "events.seen.sitrus-berry-tree", f"expected the joined stat string, got {champion['stat']!r}"
            print("OK: switching to the 'Times a specific event was seen…' family and picking an event writes events.seen.<id>")

            # Reopening must re-split the joined string back into the two controls.
            back_to_list(page)
            open_achievement(page, "champion")
            assert page.input_value('select[name="statFamily"]') == "events.seen.", "expected the family select to show events.seen. after reopening"
            assert page.input_value('select[name="statSuffix"]') == "sitrus-berry-tree", "expected the suffix select to show sitrus-berry-tree after reopening"
            print("OK: reopening champion re-splits events.seen.sitrus-berry-tree into family + suffix controls")

            git_restore("achievements.json")
            assert DATA.read_text() == baseline, "git checkout should have restored achievements.json"
            goto_achievements_tab(page, base_url)

            # --- 6. achievements.bad-threshold blocks Save ---
            open_achievement(page, "champion")
            page.fill('input[name="atLeast"]', "0")
            page.wait_for_selector("#editor-form-issues:not([hidden])", timeout=5000)
            issues_text = page.text_content("#editor-form-issues")
            assert "achievements.bad-threshold" in issues_text, f"expected achievements.bad-threshold in the issue box, got: {issues_text}"

            page.click('[data-action="save"]')
            page.wait_for_selector(".editor-modal-title", timeout=10000)
            modal_title = page.text_content(".editor-modal-title")
            modal_body = page.text_content(".editor-modal")
            assert "Save blocked" in modal_title, f"expected a 'Save blocked' modal, got {modal_title!r}"
            assert "achievements.bad-threshold" in modal_body
            page.click('[data-action="close-modal"]')
            print("OK: an atLeast of 0 surfaces achievements.bad-threshold and Save is refused")

            after_bad_save = DATA.read_text()
            assert after_bad_save == baseline, "a refused save must not touch achievements.json"

            page.once("dialog", lambda dialog: dialog.accept())
            back_to_list(page)

            # --- 7. add a new achievement, confirm it renders on achievements.html, then remove it ---
            page.click('[data-action="add-achievement"]')
            page.wait_for_selector(".achievement-row", timeout=15000)
            page.fill('input[name="id"]', "verify-fixture")
            page.fill('input[name="name"]', "Verify Fixture")
            page.fill('input[name="description"]', "A temporary fixture achievement.")
            page.fill('input[name="atLeast"]', "3")
            save(page)

            after_add = json.loads(DATA.read_text())
            assert len(after_add) == len(json.loads(baseline)) + 1 and any(a["id"] == "verify-fixture" for a in after_add), (
                "expected a new 'verify-fixture' achievement to be saved"
            )
            print("OK: adding a new achievement saves it to achievements.json")

            with serving() as game_base_url:
                game_page = browser.new_page()
                game_page.goto(f"{game_base_url}/achievements.html")
                game_page.wait_for_selector(".achievement-row", timeout=15000)
                names = [n.text_content() for n in game_page.query_selector_all(".achievement-name")]
                assert "Verify Fixture" in names, f"expected 'Verify Fixture' among achievements.html rows, got {names}"
                print("OK: achievements.html (served on 8931) renders the new achievement")
                game_page.close()

            back_to_list(page)
            open_achievement(page, "verify-fixture")
            page.once("dialog", lambda dialog: dialog.accept())
            page.click('[data-action="delete"]')
            page.wait_for_selector(ROWS, timeout=15000)
            rows = page.query_selector_all(ROWS)
            keys = [r.get_attribute("data-key") for r in rows]
            assert "verify-fixture" not in keys, "expected the fixture achievement gone"
            print("OK: the fixture 'verify-fixture' achievement was deleted")

            assert DATA.read_text() == baseline, "after adding and deleting the fixture achievement, the file should match baseline"

            # --- 8. delete guard: an event conditioned on an achievement blocks deletion ---
            events = json.loads(events_baseline)
            target_event = next(e for e in events if e["id"] == "sitrus-berry-tree")
            target_event["conditions"] = [{"mode": "has", "subject": "achievement", "name": "champion", "text": "Requires Champion"}]
            EVENTS_DATA.write_text(json.dumps(events, indent=2) + "\n")
            try:
                goto_achievements_tab(page, base_url)
                open_achievement(page, "champion")
                page.once("dialog", lambda dialog: dialog.accept())
                page.click('[data-action="delete"]')
                page.wait_for_selector(".editor-modal-title", timeout=10000)
                modal_title = page.text_content(".editor-modal-title")
                modal_body = page.text_content(".editor-modal")
                assert "Cannot delete" in modal_title, f"expected a 'Cannot delete' modal, got {modal_title!r}"
                assert "sitrus-berry-tree" in modal_body, f"expected the dialog to name sitrus-berry-tree, got: {modal_body}"
                page.click('[data-action="close-modal"]')
                print("OK: deleting an achievement referenced by an event condition is refused, naming the event")

                after_guard = DATA.read_text()
                assert after_guard == baseline, "a refused delete must not touch achievements.json"
            finally:
                EVENTS_DATA.write_text(events_baseline)

        except Exception as exc:  # noqa: BLE001 - report, restore, exit non-zero below
            failure = f"{type(exc).__name__}: {exc}"
        finally:
            git_restore("achievements.json")
            git_restore("events.json")
            browser.close()

    if DATA.read_text() != baseline:
        failure = failure or "achievements.json was not restored to baseline"
    if EVENTS_DATA.read_text() != events_baseline:
        failure = failure or "events.json was not restored to baseline"

    if failure:
        print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1

    print("OK: Achievements tab list, preview, round trip, stat picker, validation, add/delete and delete guard all verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
