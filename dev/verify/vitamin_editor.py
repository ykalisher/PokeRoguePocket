"""Verifies the data editor can author vitamin items and vitamin events.

The editor keeps its own field whitelists (dev/editor/preview.js) and its own
form definitions (tab_items.js / tab_events.js), so engine support for vitamins
does not imply editor support. This drives the real GUI:

  1. Items tab  - an existing vitamin shows its stat and dose, and the live card
                  preview renders the permanent-boost badge.
  2. Items tab  - a NEW item can be turned into a vitamin and saved, and the
                  vitamin fields survive the round-trip to disk.
  3. Items tab  - clearing the vitamin stat drops both keys (an ordinary item
                  must not keep a dangling dose, which validate.js errors on).
  4. Events tab - boost-selected-pokemon is offered and carries a Vitamin field.

Runs against a --data-dir sandbox copy, so the repo's own JSON is never written.

Usage: .cache/venv/bin/python vitamin_editor.py [screenshot.png]
"""

import contextlib
import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIBS = HERE / ".cache" / "locallibs" / "usr" / "lib" / "x86_64-linux-gnu"
PORT = 8934
BASE_URL = f"http://127.0.0.1:{PORT}"

if LIBS.is_dir():
    os.environ["LD_LIBRARY_PATH"] = f"{LIBS}:{os.environ.get('LD_LIBRARY_PATH', '')}"

from playwright.sync_api import sync_playwright  # noqa: E402

DATA_FILES = ["pokemon", "attacks", "items", "trainers", "events",
              "locations", "starter_decks", "achievements", "music"]

# Every tab's panel stays in the DOM and only the active one is displayed, so an
# unscoped row selector matches the hidden Pokemon table first. Scope to the
# visible panel.
PANEL = ".editor-tab-panel:visible"

# The detail editor is a single global region shared by every tab, rendered
# outside the panels — so its form and preview are addressed unscoped.
DETAIL = ".editor-detail-host"


def _server_running():
    try:
        conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=1)
        conn.request("HEAD", "/")
        return conn.getresponse().status < 500
    except OSError:
        return False


@contextlib.contextmanager
def sandbox_data_dir():
    """A throwaway copy of the repo data the editor may freely write to."""
    tmp = Path(tempfile.mkdtemp(prefix="vitamin-editor-"))
    for name in DATA_FILES:
        src = ROOT / f"{name}.json"
        if src.exists():
            shutil.copy2(src, tmp / f"{name}.json")
    # The asset index is read from <data-dir>/assets.
    (tmp / "assets").mkdir()
    for sub in ["portraits", "sprites", "items", "backgrounds", "music"]:
        src = ROOT / "assets" / sub
        if src.is_dir():
            shutil.copytree(src, tmp / "assets" / sub)
    try:
        yield tmp
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@contextlib.contextmanager
def serving_editor(data_dir):
    proc = subprocess.Popen(
        ["node", str(ROOT / "dev" / "editor" / "server.js"),
         "--port", str(PORT), "--data-dir", str(data_dir)],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(80):
        if _server_running():
            break
        time.sleep(0.1)
    else:
        proc.terminate()
        raise RuntimeError(f"editor server did not come up on port {PORT}")
    try:
        yield BASE_URL
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def check(condition, message):
    if not condition:
        fail(message)
    print(f"  ok: {message}")


def open_tab(page, label):
    page.click(f"#editor-tabs .editor-tab:has-text('{label}')")
    page.wait_for_selector(f"{PANEL} table.editor-table tbody tr.editor-row", timeout=15000)


def read_items(data_dir):
    return json.loads((data_dir / "items.json").read_text())


def main():
    screenshot = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "vitamin_editor.png")
    errors = []

    with sandbox_data_dir() as data_dir, serving_editor(data_dir) as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
        # A bare "Failed to load resource" console error names no URL, so the
        # response hook is what makes a 404 actionable.
        page.on(
            "console",
            lambda msg: errors.append(f"console.error: {msg.text}")
            if msg.type == "error" and "Failed to load resource" not in msg.text
            else None,
        )
        # Missing item art is a designed state, not a fault: the editor answers
        # it with an "image missing" badge and an Upload button, and this test
        # deliberately creates an artless fixture item to reach step 2.
        page.on(
            "response",
            lambda res: errors.append(f"404: {res.url}")
            if res.status == 404 and "/assets/items/" not in res.url
            else None,
        )

        page.goto(f"{base_url}/")
        page.wait_for_selector("#editor-tabs .editor-tab", timeout=15000)

        # ------------------------------------------------ 1. read a vitamin
        print("[1] An existing vitamin opens with its fields populated")
        open_tab(page, "Items")

        check(page.locator(f"{PANEL} th:has-text('Vitamin')").count() == 1,
              "the items list has a Vitamin column")

        page.click(f"{PANEL} tr.editor-row[data-key='Protein']")
        page.wait_for_selector(f"{DETAIL} .editor-preview .playing-card", timeout=15000)

        stat = page.locator(f"{DETAIL} select[name='vitaminStat']")
        check(stat.count() == 1, "the item form exposes a Vitamin stat select")
        check(stat.input_value() == "attack", f"Protein's stat reads back as attack ({stat.input_value()})")

        dose = page.locator(f"{DETAIL} input[name='vitaminAmount']")
        check(dose.count() == 1, "the item form exposes a Vitamin dose field")
        check(dose.input_value() == "5", f"Protein's dose reads back as 5 ({dose.input_value()})")

        badge = page.locator(f"{DETAIL} .editor-preview .action-vitamin-badge")
        check(badge.count() == 1, "the live card preview renders the permanent-boost badge")
        check(badge.inner_text().strip() == "+5 ATK",
              f"the badge reads +5 ATK ({badge.inner_text().strip()})")

        page.screenshot(path=screenshot, full_page=True)
        print(f"  screenshot: {screenshot}")

        # ------------------------------------------- 2. author a new vitamin
        print("\n[2] A new item can be made a vitamin and saved")
        page.click(f"{DETAIL} [data-action='back']")
        page.wait_for_selector(f"{PANEL} table.editor-table tbody tr.editor-row", timeout=15000)
        page.click(f"{PANEL} [data-action='add-item']")
        page.wait_for_selector(f"{DETAIL} input[name='name']", timeout=15000)

        page.fill(f"{DETAIL} input[name='name']", "Test Calcium")
        page.select_option(f"{DETAIL} select[name='vitaminStat']", "defense")
        page.wait_for_selector(f"{DETAIL} input[name='vitaminAmount']", timeout=5000)
        check(page.locator(f"{DETAIL} input[name='vitaminAmount']").input_value() == "5",
              "choosing a stat seeds the default dose of 5")

        page.fill(f"{DETAIL} input[name='vitaminAmount']", "7")
        page.wait_for_timeout(200)

        page.click(f"{DETAIL} [data-action='save']")
        page.wait_for_timeout(1000)

        created = [item for item in read_items(data_dir) if item.get("name") == "Test Calcium"]
        check(len(created) == 1, "the new item was written to items.json")
        check(created[0].get("vitaminStat") == "defense",
              f"vitaminStat persisted ({created[0].get('vitaminStat')})")
        check(created[0].get("vitaminAmount") == 7,
              f"vitaminAmount persisted as a number ({created[0].get('vitaminAmount')!r})")
        check(page.locator(f"{DETAIL} .editor-badge--warning:has-text('image missing')").count() == 1,
              "the artless fixture gets the editor's 'image missing' badge, not a silent break")

        # ------------------------------------- 3. clearing drops both fields
        print("\n[3] Clearing the vitamin stat drops both keys")
        page.select_option(f"{DETAIL} select[name='vitaminStat']", "")
        page.wait_for_timeout(300)
        check(page.locator(f"{DETAIL} input[name='vitaminAmount']").count() == 0,
              "the dose field disappears when the stat is cleared")

        page.click(f"{DETAIL} [data-action='save']")
        page.wait_for_timeout(1000)

        cleared = [item for item in read_items(data_dir) if item.get("name") == "Test Calcium"][0]
        check("vitaminStat" not in cleared, "vitaminStat was removed, not blanked")
        check("vitaminAmount" not in cleared,
              "vitaminAmount was removed too (a dangling dose is a validation error)")

        # --------------------------------------------- 4. the event effect
        print("\n[4] The events tab offers boost-selected-pokemon")
        open_tab(page, "Events")
        page.click(f"{PANEL} tr.editor-row[data-key='vitamin-protein']")
        page.wait_for_selector(f"{DETAIL} select[data-scope='eff-type']", timeout=15000)

        offered = page.eval_on_selector(
            f"{DETAIL} select[data-scope='eff-type']",
            "select => [...select.options].map(option => option.value)")
        check("boost-selected-pokemon" in offered,
              "boost-selected-pokemon is in the effect-type dropdown")

        item_field = page.locator(f"{DETAIL} input[data-field='item']")
        check(item_field.count() == 1, "the effect exposes a Vitamin item field")
        check(item_field.input_value() == "Protein",
              f"it reads back the authored vitamin ({item_field.input_value()})")
        check(page.locator(f"{DETAIL} input[data-field='item'] ~ .editor-badge").count() == 0,
              "a valid vitamin name shows no 'unknown' badge")

        browser.close()

    if errors:
        print("\nPage errors:")
        for err in errors:
            print(" ", err)
        fail(f"{len(errors)} page/console error(s)")

    print("\nOK: the dev editor fully supports vitamin items and vitamin events.")


if __name__ == "__main__":
    main()
