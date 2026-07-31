"""Authors a whole card-swap event through the data editor GUI, with no hand
edits to any JSON, to prove the tool covers the rotom-appliances shape:
event-level `has` condition, a choice, a requirement filtered to one card
("Only this card"), and a replace-selected-card effect wired to it.

Runs the editor server against a COPY of the data files (--data-dir into a temp
dir), so the tracked JSON is never touched. Asserts against the saved file on
disk, then re-checks the result through the shared validator.

Usage: .cache/venv/bin/python editor_author_event.py [screenshot.png]
Exits non-zero on any page error or failed assertion.
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
FILE_NAMES = ["pokemon", "attacks", "items", "trainers", "events", "locations"]

# The event this driver builds click-by-click.
EVENT_ID = "verify-authored-swap"
PICKED_CARD = "Scyther"
REPLACEMENT_CARD = "Scizor"

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
    # The form commits on input; blur keeps the draft in sync before a repaint.
    page.dispatch_event(selector, "change")


def main():
    screenshot_path = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "editor_author_event.png")
    errors = []
    tmp = Path(tempfile.mkdtemp(prefix="pokerogue-editor-"))

    try:
        for name in FILE_NAMES:
            shutil.copy(ROOT / f"{name}.json", tmp / f"{name}.json")

        with serving_editor(tmp) as base_url, sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
            page.on(
                "console",
                lambda msg: errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
            )
            # Surfaces a blocked write (409) rather than leaving a bare
            # "event missing from the saved file" at the end.
            page.on("response", lambda r: print(f"  HTTP {r.request.method} {r.url} {r.status}")
                    if "/api/" in r.url and r.request.method != "GET" and r.status >= 300 else None)

            page.goto(f"{base_url}/")
            page.wait_for_selector("#editor-tabs .editor-tab", timeout=15000)
            open_events_tab(page)

            # ---- new choice event ----
            page.click(".editor-tab-toolbar [data-action='add-choice']")
            page.wait_for_selector("input[data-scope='common'][data-field='id']", timeout=15000)

            fill(page, "input[data-scope='common'][data-field='id']", EVENT_ID)
            fill(page, "input[data-scope='common'][data-field='title']", "Authored Swap")
            fill(page, "[data-scope='common'][data-field='body']", "A GUI-authored card swap.")

            # ---- event-level condition: only offer this while the run owns the card ----
            page.click("[data-action='add-cond'][data-owner='event']")
            cond = "[data-scope='cond'][data-owner='event'][data-index='0'][data-field='name']"
            fill(page, cond, PICKED_CARD)

            # ---- the choice's requirement, filtered to that one card ----
            page.click("[data-action='add-req'][data-owner='choice:0']")
            req = "[data-scope='req'][data-owner='choice:0'][data-index='0']"
            fill(page, f"{req}[data-field='id']", "target")
            fill(page, f"{req}[data-field='name']", PICKED_CARD)
            fill(page, f"{req}[data-field='label']", "Choose your Scyther")

            fill(page, "input[data-scope='choice'][data-choice='0'][data-field='title']", "Fit the Metal Coat")

            # ---- the effect, wired to that requirement ----
            page.click("[data-action='add-effect'][data-owner='choice:0']")
            eff = "[data-owner='choice:0'][data-index='0']"
            page.select_option(f"select[data-scope='eff-type']{eff}", "replace-selected-card")
            page.wait_for_selector(f"select[data-scope='eff-selection']{eff}", timeout=10000)
            page.select_option(f"select[data-scope='eff-selection']{eff}", "target")
            page.select_option(f"select[data-scope='eff-repl-cardkind']{eff}", "pokemon")
            fill(page, f"input[data-scope='eff-repl']{eff}[data-field='name']", REPLACEMENT_CARD)

            page.screenshot(path=screenshot_path, full_page=True)
            print(f"screenshot: {screenshot_path}")

            page.click("[data-action='save']")

            # page.evaluate awaits the promise (wait_for_function would just see
            # a truthy Promise object), so poll the served data that way.
            saved_ok = False
            for _ in range(30):
                ids = page.evaluate(
                    "() => fetch('/api/data').then((res) => res.json())"
                    ".then((data) => (data.events || []).map((event) => event.id))"
                )
                if EVENT_ID in ids:
                    saved_ok = True
                    break
                time.sleep(0.5)

            if not saved_ok:
                dialog = page.query_selector(".editor-modal, .editor-toast")
                detail = (dialog.text_content() or "").strip() if dialog else "(no dialog shown)"
                print(f"  FAIL save did not land. Editor said: {detail}")

            browser.close()

        saved = json.loads((tmp / "events.json").read_text())
        record = next((event for event in saved if event.get("id") == EVENT_ID), None)
        assert record is not None, "authored event is missing from the saved events.json"
        print(json.dumps(record, indent=2))

        ok = True

        def check(label, actual, expected):
            nonlocal ok
            if actual == expected:
                print(f"  OK   {label}")
            else:
                ok = False
                print(f"  FAIL {label}: {actual!r} != {expected!r}")

        choice = (record.get("choices") or [{}])[0]
        requirement = (choice.get("requires") or [{}])[0]
        effect = (choice.get("effects") or [{}])[0]

        check("event type", record.get("type"), "choice")
        check("event condition", record.get("conditions"),
              [{"mode": "has", "cardKind": "pokemon", "name": PICKED_CARD}])
        check("requirement id", requirement.get("id"), "target")
        check("requirement cardKind", requirement.get("cardKind"), "pokemon")
        check("requirement name filter", requirement.get("name"), PICKED_CARD)
        check("requirement label", requirement.get("label"), "Choose your Scyther")
        check("effect type", effect.get("type"), "replace-selected-card")
        check("effect selectionId", effect.get("selectionId"), "target")
        check("effect replacement", effect.get("replacement"),
              {"cardKind": "pokemon", "name": REPLACEMENT_CARD})

        # The saved file must also be clean by the shared validator.
        issues = subprocess.run(
            ["node", "-e", """
                const fs = require('fs');
                const path = process.argv[1];
                const { validateAll } = require('./dev/editor/validate.js');
                const options = require('./scripts/data_options.js');
                const data = {};
                ['pokemon', 'attacks', 'items', 'trainers', 'events', 'locations'].forEach((name) => {
                    data[name] = JSON.parse(fs.readFileSync(`${path}/${name}.json`, 'utf8'));
                });
                const errorsOnly = validateAll(data, { enums: options })
                    .filter((issue) => issue.severity === 'error');
                console.log(JSON.stringify(errorsOnly));
            """, str(tmp)],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout
        reported = json.loads(issues)
        if reported:
            ok = False
            print(f"  FAIL validator reported {len(reported)} error(s): {reported[:3]}")
        else:
            print("  OK   validator reports no errors for the authored file")

        if errors:
            ok = False
            print("Page/console errors:")
            for err in errors:
                print(f"  {err}")

        print("PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
