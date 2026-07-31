"""Phase 74 verification: authoring event card conditions in the data editor.

Spawns `node dev/editor/server.js` on port 8933 (same pattern as drive_editor.py),
opens the Events tab, and drives the new "card conditions" UI on a real event:
adds a condition, checks the unknown badge / datalist follow the card kind, reads
the LEFT preview text, saves, and inspects `git diff events.json` to prove the
round trip. Removing the last condition must drop the key entirely.

Also builds an unsaved draft with a choice and a payment option to confirm the
"Choice card conditions" / "Payment card conditions" subsections render there.

events.json is restored with `git checkout --` before exit either way.

Usage: .cache/venv/bin/python phase74_editor_conditions.py [screenshot.png]
Exits non-zero on any page error or failed assertion.
"""

import json
import subprocess
import sys
from pathlib import Path

from drive_editor import ROOT, git_clean, git_restore, serving_editor

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
EVENT_ID = "rotom-tv"          # a gift event: exercises the event-level list
KNOWN_POKEMON = "Rotom"
NONSENSE = "Zzzzznotacard"
KNOWN_ITEM = "Sitrus Berry"

# Tab panels stay in the DOM and are toggled with [hidden]; every list selector
# must be scoped to the visible one or it matches the pokemon tab's rows.
PANEL = ".editor-tab-panel:not([hidden])"
ROWS = f"{PANEL} table.editor-table tbody tr.editor-row"


def git_diff_events():
    return subprocess.run(
        ["git", "diff", "--", "events.json"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout


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


def section(page, title):
    """The .editor-events-subsection whose <h4> is `title`."""
    return page.query_selector(
        f'xpath=//div[@class="editor-events-subsection"][h4[normalize-space()="{title}"]]'
    )


def main():
    screenshot_path = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "phase74_editor_conditions.png")
    actions_shot_path = str(Path(screenshot_path).with_name(
        Path(screenshot_path).stem + "_actions" + Path(screenshot_path).suffix))

    if not git_clean("events.json"):
        print("FAIL: events.json has uncommitted changes before the run starts", file=sys.stderr)
        return 1

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

            # ---- 1. round trip with no edits at all -------------------------
            open_event(page, EVENT_ID)
            assert section(page, "Event card conditions"), "Event card conditions section missing"
            save(page)
            assert git_diff_events() == "", "saving an unedited event produced a diff"
            page.click('[data-action="back"]')
            page.wait_for_selector(ROWS, timeout=15000)

            # ---- 2. add a condition and inspect its defaults ----------------
            open_event(page, EVENT_ID)
            page.click('.editor-events-subsection:has(h4:text-is("Event card conditions")) [data-action="add-cond"]')
            page.wait_for_selector('[data-scope="cond-mode"][data-owner="event"]', timeout=5000)
            mode = page.input_value('[data-scope="cond-mode"][data-owner="event"][data-index="0"]')
            kind = page.input_value('[data-scope="cond-cardkind"][data-owner="event"][data-index="0"]')
            name = page.input_value('[data-scope="cond"][data-owner="event"][data-index="0"][data-field="name"]')
            assert (mode, kind, name) == ("has", "pokemon", ""), f"bad defaults: {(mode, kind, name)}"

            name_sel = '[data-scope="cond"][data-owner="event"][data-index="0"][data-field="name"]'
            mode_sel = '[data-scope="cond-mode"][data-owner="event"][data-index="0"]'

            def repaint():
                """Typing does not repaint the form (input listener commits with
                repaint=false, same as the effect name fields), so the unknown
                badge only re-evaluates after a structural change."""
                page.select_option(mode_sel, "lacks")
                page.wait_for_timeout(150)
                page.select_option(mode_sel, "has")
                page.wait_for_timeout(150)

            # nonsense name -> unknown badge
            page.fill(name_sel, NONSENSE)
            repaint()
            assert page.query_selector(
                '.editor-events-subsection:has(h4:text-is("Event card conditions")) .editor-badge--warning'
            ), "nonsense card name did not raise the unknown badge"

            # real name -> badge clears, preview reads "Requires <name>"
            page.fill(name_sel, KNOWN_POKEMON)
            repaint()
            assert not page.query_selector(
                '.editor-events-subsection:has(h4:text-is("Event card conditions")) .editor-badge--warning'
            ), f"'{KNOWN_POKEMON}' still shows the unknown badge"
            preview = page.text_content(".editor-events-preview")
            assert f"Requires {KNOWN_POKEMON}" in preview, f"preview missing 'Requires {KNOWN_POKEMON}': {preview!r}"

            # mode switch -> "Only without <name>"
            page.select_option(mode_sel, "lacks")
            page.wait_for_timeout(250)
            preview = page.text_content(".editor-events-preview")
            assert f"Only without {KNOWN_POKEMON}" in preview, f"preview missing 'Only without': {preview!r}"
            page.select_option(mode_sel, "has")
            page.wait_for_timeout(250)

            # card kind switch re-points the datalist (and the badge follows)
            pokemon_list = page.get_attribute(name_sel, "list")
            page.select_option('[data-scope="cond-cardkind"][data-owner="event"][data-index="0"]', "item")
            page.wait_for_timeout(250)
            item_list = page.get_attribute(name_sel, "list")
            assert item_list != pokemon_list, f"datalist did not change with card kind ({item_list})"
            assert "items" in item_list, f"item datalist expected, got {item_list}"
            assert page.query_selector(
                '.editor-events-subsection:has(h4:text-is("Event card conditions")) .editor-badge--warning'
            ), "a pokemon name under cardKind=item should read as unknown"
            page.fill(name_sel, KNOWN_ITEM)
            repaint()
            assert not page.query_selector(
                '.editor-events-subsection:has(h4:text-is("Event card conditions")) .editor-badge--warning'
            ), f"'{KNOWN_ITEM}' still shows the unknown badge under cardKind=item"

            # back to the pokemon condition we want to persist
            page.select_option('[data-scope="cond-cardkind"][data-owner="event"][data-index="0"]', "pokemon")
            page.wait_for_timeout(200)
            page.fill(name_sel, KNOWN_POKEMON)
            page.wait_for_timeout(250)

            # ---- 3. save: the diff must be exactly the conditions array -----
            save(page)
            diff = git_diff_events()
            added = [line[1:].strip() for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++")]
            removed = [line[1:].strip() for line in diff.splitlines() if line.startswith("-") and not line.startswith("---")]
            # The only line the insert may "remove" is the previous last member of
            # the record, reappearing with a trailing comma.
            reflowed = [line for line in removed if f"{line}," not in added]
            assert reflowed == [], f"save removed lines it should not have: {reflowed}\n{diff}"
            joined = " ".join(added)
            assert '"conditions"' in joined, f"no conditions key in the diff:\n{diff}"
            assert '"mode": "has"' in joined and '"cardKind": "pokemon"' in joined \
                and f'"name": "{KNOWN_POKEMON}"' in joined, f"condition fields missing from diff:\n{diff}"
            for line in added:
                assert not line.startswith('"choices"') and "payment" not in line, \
                    f"unexpected line in diff: {line}"

            saved = json.loads((ROOT / "events.json").read_text())
            record = next(e for e in saved if e["id"] == EVENT_ID)
            assert record["conditions"] == [{"mode": "has", "cardKind": "pokemon", "name": KNOWN_POKEMON}], \
                f"unexpected saved conditions: {record.get('conditions')}"
            page.screenshot(path=screenshot_path, full_page=True)
            print(f"screenshot: {screenshot_path}")

            # ---- 4. removing the last condition deletes the key ------------
            page.click('[data-action="back"]')
            page.wait_for_selector(ROWS, timeout=15000)
            open_event(page, EVENT_ID)
            page.click('.editor-events-subsection:has(h4:text-is("Event card conditions")) [data-action="remove-cond"]')
            page.wait_for_timeout(200)
            assert page.query_selector(
                '.editor-events-subsection:has(h4:text-is("Event card conditions")) .editor-empty'
            ), "removing the row left the list non-empty"
            save(page)
            assert git_diff_events() == "", f"removing the last condition left a diff:\n{git_diff_events()}"
            saved = json.loads((ROOT / "events.json").read_text())
            record = next(e for e in saved if e["id"] == EVENT_ID)
            assert "conditions" not in record, "conditions key survived removal of the last row"

            # ---- 5. choice + payment sections, on a draft that is never saved
            # (no event in events.json has choices or a payment option yet).
            page.select_option('[data-scope="event-type"]', "choice")
            page.wait_for_timeout(200)
            # scoped to the form: the list toolbar has a "+ Choice event" button too
            page.click('.editor-events-form [data-action="add-choice"]')
            page.wait_for_timeout(200)
            assert section(page, "Choice card conditions"), "Choice card conditions section missing"
            page.click('.editor-events-choice [data-action="add-cond"]')
            page.wait_for_timeout(200)
            page.fill('[data-scope="cond"][data-owner="choice:0"][data-index="0"][data-field="name"]', KNOWN_POKEMON)
            page.wait_for_timeout(300)
            assert f"Requires {KNOWN_POKEMON}" in page.text_content(".editor-events-preview"), \
                "choice-level condition missing from the preview"
            page.screenshot(path=actions_shot_path, full_page=True)
            print(f"screenshot: {actions_shot_path}")

            page.select_option('[data-scope="event-type"]', "trainer")
            page.wait_for_timeout(200)
            page.click('.editor-events-form [data-action="add-payment"]')
            page.wait_for_timeout(200)
            assert section(page, "Payment card conditions"), "Payment card conditions section missing"
            page.click('.editor-events-subzone [data-action="add-cond"]')
            page.wait_for_timeout(200)
            page.fill('[data-scope="cond"][data-owner="payment"][data-index="0"][data-field="name"]', KNOWN_POKEMON)
            page.select_option('[data-scope="cond-mode"][data-owner="payment"][data-index="0"]', "lacks")
            page.wait_for_timeout(300)
            assert f"Only without {KNOWN_POKEMON}" in page.text_content(".editor-events-preview"), \
                "payment-level condition missing from the preview"

            # Discard the scratch draft: nothing here belongs in events.json.
            page.click('[data-action="revert"]')
            page.wait_for_timeout(300)
            assert git_diff_events() == "", f"scratch draft reached the file:\n{git_diff_events()}"
        except Exception as exc:  # noqa: BLE001 - report, restore, exit non-zero below
            failure = f"{type(exc).__name__}: {exc}"
        finally:
            git_restore("events.json")
            browser.close()

    if failure:
        print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1

    print("OK: event/choice/payment condition editors render, round-trip, and clean up their key")
    return 0


if __name__ == "__main__":
    sys.exit(main())
