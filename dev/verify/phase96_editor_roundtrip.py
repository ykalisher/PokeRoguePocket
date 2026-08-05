"""Phase 96 editor round-trip check: opens the "rotom-appliances" event (which
already has real card conditions) in the local data editor, confirms an
unchanged Save is byte-identical, then exercises the new achievement-subject
condition control.

The editor server does not yet load achievements.json into EditorApp.store.data
(that's phase 97's job), so an achievement condition here always resolves to an
"unknown achievement" write-guard error -- exactly what dev/editor/validate.js's
new events.unknown-condition-achievement rule (phase 96 step 6) is supposed to
report. This script treats that blocked save as the expected, correct outcome
and asserts on it, rather than forcing a write past it. It separately asserts,
via the rendered DOM (which paint() always redraws from the live draft object),
that switching Subject to "achievement" removes the Card kind control and
switching it back to "card" removes the achievement Achievement field and
restores a default Card kind of pokemon -- the round-trip fidelity the phase
requires of the client-side mutation logic in tab_events.js.

Runs the editor server against a COPY of the data files (--data-dir into a temp
dir), so the tracked JSON is never touched.

Usage: .cache/venv/bin/python phase96_editor_roundtrip.py
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
PORT = 8935
BASE_URL = f"http://127.0.0.1:{PORT}"
FILE_NAMES = ["pokemon", "attacks", "items", "trainers", "events", "locations", "starter_decks"]
EVENT_ID = "rotom-appliances"

if LIBS.is_dir():
    os.environ["LD_LIBRARY_PATH"] = f"{LIBS}:{os.environ.get('LD_LIBRARY_PATH', '')}"

from playwright.sync_api import sync_playwright  # noqa: E402


def _server_running():
    try:
        conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=1)
        conn.request("HEAD", "/")
        return conn.getresponse().status == 200
    except OSError:
        return False


@contextlib.contextmanager
def serving_editor(data_dir):
    proc = subprocess.Popen(
        ["node", str(ROOT / "dev" / "editor" / "server.js"),
         "--port", str(PORT), "--data-dir", str(data_dir)],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    try:
        for _ in range(50):
            if _server_running():
                break
            if proc.poll() is not None:
                stderr = proc.stderr.read().decode("utf8", "replace")
                raise RuntimeError(f"editor server exited early:\n{stderr}")
            time.sleep(0.1)
        else:
            raise RuntimeError(f"editor server did not come up on port {PORT}")
        yield BASE_URL
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def open_events_tab(page):
    for tab in page.query_selector_all("#editor-tabs .editor-tab"):
        if (tab.text_content() or "").strip().lower().startswith("event"):
            tab.click()
            return
    raise AssertionError("no Events tab found")


def fill(page, selector, value):
    page.wait_for_selector(selector, timeout=10000)
    page.fill(selector, value)
    page.dispatch_event(selector, "change")


def main():
    ok = True
    errors = []
    tmp = Path(tempfile.mkdtemp(prefix="pokerogue-editor-roundtrip-"))

    def check(label, actual, expected):
        nonlocal ok
        if actual == expected:
            print(f"  OK   {label}")
        else:
            ok = False
            print(f"  FAIL {label}: {actual!r} != {expected!r}")

    try:
        for name in FILE_NAMES:
            shutil.copy(ROOT / f"{name}.json", tmp / f"{name}.json")
        before_bytes = (tmp / "events.json").read_bytes()

        with serving_editor(tmp) as base_url, sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
            page.on(
                "console",
                lambda msg: errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
            )

            page.goto(f"{base_url}/")
            page.wait_for_selector("#editor-tabs .editor-tab", timeout=15000)
            open_events_tab(page)

            page.wait_for_selector(f"tr[data-key='{EVENT_ID}']", timeout=15000)
            page.click(f"tr[data-key='{EVENT_ID}']")
            page.wait_for_selector("input[data-scope='common'][data-field='id']", timeout=15000)

            cond_row = "li:has(select[data-scope='cond-mode'][data-owner='event'][data-index='0'])"
            page.wait_for_selector(cond_row, timeout=10000)
            existing_name = page.get_attribute(
                "input[data-scope='cond'][data-owner='event'][data-index='0'][data-field='name']", "value")
            print(f"existing event-level condition name: {existing_name!r}")

            # ---- 1. unchanged Save is byte-identical ----
            page.click("[data-action='save']")
            for _ in range(30):
                current = (tmp / "events.json").read_bytes()
                if current != before_bytes:
                    break
                time.sleep(0.2)
            after_unchanged = (tmp / "events.json").read_bytes()
            check("unchanged Save leaves events.json byte-identical", after_unchanged == before_bytes, True)

            # ---- 2. flip the event-level condition to achievement ----
            page.select_option(
                "select[data-scope='cond-subject'][data-owner='event'][data-index='0']", "achievement")
            page.wait_for_selector(
                "select[data-scope='cond-cardkind'][data-owner='event'][data-index='0']", state="detached")
            check("Card kind select disappears once subject is achievement",
                  page.query_selector("select[data-scope='cond-cardkind'][data-owner='event'][data-index='0']"),
                  None)
            achievement_field = "input[data-scope='cond'][data-owner='event'][data-index='0'][data-field='name']"
            check("Achievement field starts blank after the switch",
                  page.get_attribute(achievement_field, "value"), "")
            fill(page, achievement_field, "first-blood")

            page.click("[data-action='save']")
            page.wait_for_selector(".editor-modal", timeout=10000)
            modal_text = page.text_content(".editor-modal") or ""
            check("blocked save reports the new unknown-achievement code",
                  "events.unknown-condition-achievement" in modal_text, True)
            page.click("[data-action='close-modal']")

            after_blocked = (tmp / "events.json").read_bytes()
            check("a blocked save never touches events.json on disk", after_blocked == before_bytes, True)

            # ---- 3. flip back to card: subject/achievement text clears, cardKind restored ----
            page.select_option(
                "select[data-scope='cond-subject'][data-owner='event'][data-index='0']", "card")
            page.wait_for_selector(
                "select[data-scope='cond-cardkind'][data-owner='event'][data-index='0']", timeout=10000)
            check("Card kind restores to pokemon after flipping back",
                  page.eval_on_selector(
                      "select[data-scope='cond-cardkind'][data-owner='event'][data-index='0']", "el => el.value"),
                  "pokemon")
            check("Card name field clears after flipping back",
                  page.get_attribute(
                      "input[data-scope='cond'][data-owner='event'][data-index='0'][data-field='name']", "value"),
                  "")

            page.screenshot(path=str(HERE / "phase96_editor_roundtrip.png"))
            browser.close()

        # The blocked save's 409 is expected (asserted on above) and Chromium
        # logs the failed fetch as a console error; filter that one out.
        real_errors = [e for e in errors if "409 (Conflict)" not in e]
        if real_errors:
            ok = False
            print("Page/console errors:")
            for err in real_errors:
                print(f"  {err}")

        print("PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
