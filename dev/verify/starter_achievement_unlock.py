"""Verification: achievement-gated starter decks, end to end.

1. Data editor (port 8933): open the Starters tab, gate the fire deck on the
   "Champion" achievement with the new "Unlocked by achievement" select, save,
   and confirm `requiresAchievement` landed in starter_decks.json.
2. starter.html (port 8931) with an empty profile: fire renders locked,
   disabled, with the requirement blurb; water/grass stay pickable; clicking
   the locked card does nothing.
3. area.html?newRun=1&starter=fire with an empty profile: the gate is not
   bypassable by URL -- the run falls back to an unlocked deck.
4. Seed the profile with the champion unlock: fire becomes pickable and the
   URL path builds a real fire run.
5. Clearing the required achievement id in the editor ("Always available")
   returns the deck to an ungated state.

starter_decks.json is restored via `git checkout` before exit either way.

Usage: .cache/venv/bin/python starter_achievement_unlock.py [screenshot.png]
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
GATE_SELECT = 'select[name="requiresAchievement"]'

RUN_KEY = "pokemon-rogue-pocket-run"
PROFILE_KEY = "pokemon-rogue-pocket-profile"
UNLOCKED_PROFILE = json.dumps({
    "pendingUnlocks": [],
    "stats": {"runs.completed": 1},
    "unlocked": {"champion": "2026-08-09T00:00:00.000Z"},
    "version": 1,
})


def open_deck(page, deck_id):
    page.click(f'{ROWS}[data-key="{deck_id}"]')
    page.wait_for_selector(".editor-trainer-preview", timeout=15000)


def back_to_list(page):
    page.click('[data-action="back"]')
    page.wait_for_selector(ROWS, timeout=15000)


def save(page):
    page.click('[data-action="save"]')
    page.wait_for_timeout(400)


def deck_record(deck_id):
    return next(d for d in json.loads(DATA.read_text()) if d["id"] == deck_id)


def gate_fire_deck(page, screenshot_path):
    """Steps 1 + 5 live here: set the gate, then (later) clear it."""
    page.goto(f"{page.context.editor_base}/")
    page.wait_for_selector('#editor-tabs .editor-tab[data-tab="starters"]', timeout=15000)
    page.click('#editor-tabs .editor-tab[data-tab="starters"]')
    page.wait_for_selector(ROWS, timeout=15000)

    open_deck(page, "fire")
    options = page.eval_on_selector_all(
        f"{GATE_SELECT} option", "els => els.map(e => [e.value, e.textContent.trim()])")
    assert options[0][0] == "", f"expected a blank 'always available' option first, got {options}"
    assert ["champion", "Champion"] in [list(o) for o in options], \
        f"expected the Champion achievement in the gate select, got {options}"
    assert page.eval_on_selector(GATE_SELECT, "el => el.value") == "", "fire should start ungated"
    print(f"OK: gate select offers {[o[1] for o in options]}")

    page.select_option(GATE_SELECT, "champion")
    page.wait_for_timeout(250)
    preview = page.text_content(".editor-trainer-preview")
    assert "Champion" in preview, f"expected the lock badge in the preview, got {preview[:120]!r}"
    assert "unknown" not in preview, "a known achievement must not render the unknown badge"
    page.screenshot(path=screenshot_path)
    print(f"OK: preview shows the lock badge; screenshot: {screenshot_path}")

    save(page)
    record = deck_record("fire")
    assert record.get("requiresAchievement") == "champion", \
        f"expected requiresAchievement=champion on disk, got {record.get('requiresAchievement')!r}"
    assert list(json.loads(DATA.read_text())[0].keys())[0] == "id", "record key order should be unchanged"
    print("OK: save wrote requiresAchievement=champion to starter_decks.json")

    back_to_list(page)
    row = page.query_selector(f'{ROWS}[data-key="fire"]')
    unlocked_cell = row.query_selector_all("td")[5].text_content().strip()
    assert "Champion" in unlocked_cell, f"expected the 'Unlocked by' column to show Champion, got {unlocked_cell!r}"
    print("OK: the list view's 'Unlocked by' column shows Champion")


def clear_gate(page):
    open_deck(page, "fire")
    assert page.eval_on_selector(GATE_SELECT, "el => el.value") == "champion", \
        "reopening the deck should show the saved gate"
    page.select_option(GATE_SELECT, "")
    page.wait_for_timeout(250)
    save(page)
    record = deck_record("fire")
    assert "requiresAchievement" not in record, \
        f"'Always available' must drop the key entirely, got {record.get('requiresAchievement')!r}"
    print("OK: 'Always available' removes requiresAchievement from the record")


def check_locked_picker(page, base, screenshot_path):
    page.goto(f"{base}/starter.html")
    page.wait_for_selector(".starter-card[data-starter='water']", timeout=15000)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)

    fire = page.query_selector(".starter-card[data-starter='fire']")
    assert "starter-card--locked" in (fire.get_attribute("class") or ""), "fire should render locked"
    assert fire.is_disabled(), "a locked deck's button must be disabled"
    lock_text = page.text_content(".starter-card[data-starter='fire'] .starter-card-lock")
    assert "Champion" in lock_text, f"expected the achievement name in the lock blurb, got {lock_text!r}"
    assert "Finish a full run" in lock_text, f"expected the achievement description, got {lock_text!r}"
    assert page.query_selector(".starter-card[data-starter='fire'] .starter-card-cta") is None, \
        "a locked deck must not show the 'Choose this deck' call to action"

    for open_id in ("water", "grass"):
        card = page.query_selector(f".starter-card[data-starter='{open_id}']")
        assert not card.is_disabled(), f"{open_id} should stay pickable"
        assert "starter-card--locked" not in (card.get_attribute("class") or "")
    page.screenshot(path=screenshot_path)
    print(f"OK: fire is locked with its requirement blurb, water/grass pickable; screenshot: {screenshot_path}")

    page.click(".starter-card[data-starter='fire']", force=True)
    page.wait_for_timeout(400)
    assert page.evaluate("location.pathname").endswith("starter.html"), \
        "clicking a locked deck must not navigate to a run"
    print("OK: clicking the locked deck does nothing")


def check_url_cannot_bypass(page, base):
    page.goto(f"{base}/starter.html")
    page.wait_for_selector(".starter-card", timeout=15000)
    page.evaluate("localStorage.clear()")
    page.goto(f"{base}/area.html?newRun=1&starter=fire")
    page.wait_for_function(f"() => localStorage.getItem('{RUN_KEY}')", timeout=15000)
    run = json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))
    assert run.get("starterId") != "fire", "a locked deck must not be reachable via the newRun URL"
    print(f"OK: area.html?starter=fire fell back to '{run.get('starterId')}' while locked")


def check_unlocked_picker(page, base, screenshot_path):
    page.goto(f"{base}/starter.html")
    page.wait_for_selector(".starter-card", timeout=15000)
    page.evaluate(f"localStorage.clear(); localStorage.setItem('{PROFILE_KEY}', {UNLOCKED_PROFILE!r})")
    page.reload()
    page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)

    fire = page.query_selector(".starter-card[data-starter='fire']")
    assert not fire.is_disabled(), "fire should be pickable once champion is unlocked"
    assert "starter-card--locked" not in (fire.get_attribute("class") or "")
    assert page.query_selector(".starter-card[data-starter='fire'] .starter-card-cta") is not None, \
        "an unlocked deck shows the call to action again"
    page.screenshot(path=screenshot_path)
    print(f"OK: champion unlocked -> fire is pickable again; screenshot: {screenshot_path}")

    page.click(".starter-card[data-starter='fire']")
    page.wait_for_function(f"() => localStorage.getItem('{RUN_KEY}')", timeout=15000)
    run = json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))
    assert run.get("starterId") == "fire", f"expected a fire run, got {run.get('starterId')!r}"
    names = sorted(c["pokemon"]["name"] for c in run["collections"]["pokemon"])
    assert names == ["Charizard", "Typhlosion"], f"expected the fire deck's pokemon, got {names}"
    print(f"OK: the unlocked fire run builds the real fire deck ({names})")


def main():
    shot = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "starter_achievement_unlock.png")
    shot_base = shot[:-4] if shot.endswith(".png") else shot

    if not git_clean("starter_decks.json"):
        print("FAIL: starter_decks.json has uncommitted changes before the run starts", file=sys.stderr)
        return 1

    errors = []
    failure = None

    with serving_editor() as editor_base, serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 1100})
        context.editor_base = editor_base
        page = context.new_page()
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
        page.on("console", lambda msg: errors.append(f"console.error: {msg.text}")
                if msg.type == "error" and "Failed to load resource" not in msg.text else None)

        try:
            gate_fire_deck(page, f"{shot_base}_editor.png")
            check_locked_picker(page, base, f"{shot_base}_locked.png")
            check_url_cannot_bypass(page, base)
            check_unlocked_picker(page, base, f"{shot_base}_unlocked.png")
            page.goto(f"{editor_base}/")
            page.wait_for_selector('#editor-tabs .editor-tab[data-tab="starters"]', timeout=15000)
            page.click('#editor-tabs .editor-tab[data-tab="starters"]')
            page.wait_for_selector(ROWS, timeout=15000)
            clear_gate(page)
        except Exception as err:  # noqa: BLE001 - reported below, restore still runs
            failure = err
        finally:
            browser.close()

    git_restore("starter_decks.json")

    if failure is not None:
        print(f"FAIL: {failure}", file=sys.stderr)
    if errors:
        print("PAGE ERRORS:")
        for err in errors:
            print(" ", err)

    ok = failure is None and not errors
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
