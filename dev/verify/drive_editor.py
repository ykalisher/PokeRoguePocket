"""Smoke-drives the dev-only data editor in headless Chromium.

Unlike the battle drivers (lib.py's `serving()`, port 8931, python http.server)
the editor is served by the Node server on its own port, so this driver spawns
`node dev/editor/server.js` itself and always tears it down.

Usage: .cache/venv/bin/python drive_editor.py [screenshot.png]
Exits non-zero on any page error or a failed assertion. Writes hit the real
repo `pokemon.json` (no --data-dir override) and are restored via `git
checkout` before exit either way.
"""

import contextlib
import http.client
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIBS = HERE / ".cache" / "locallibs" / "usr" / "lib" / "x86_64-linux-gnu"
PORT = 8933
BASE_URL = f"http://127.0.0.1:{PORT}"

# Must happen before Playwright launches the browser subprocess.
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
def serving_editor():
    proc = subprocess.Popen(
        ["node", str(ROOT / "dev" / "editor" / "server.js"), "--port", str(PORT)],
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
            raise RuntimeError("editor server did not come up on port %d" % PORT)
        yield BASE_URL
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def git_clean(relative_path):
    out = subprocess.run(
        ["git", "status", "--porcelain", "--", relative_path],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    return out.strip() == ""


def git_restore(relative_path):
    subprocess.run(["git", "checkout", "--", relative_path], cwd=ROOT, check=True)


def main():
    screenshot_path = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "editor_smoke.png")

    if not git_clean("pokemon.json"):
        print("FAIL: pokemon.json has uncommitted changes before the smoke test even starts", file=sys.stderr)
        return 1

    errors = []
    failure = None
    rows = []

    with serving_editor() as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
        page.on(
            "console",
            lambda msg: errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
        )

        try:
            page.goto(f"{base_url}/")
            page.wait_for_selector("#editor-tabs .editor-tab", timeout=15000)

            tabs = page.query_selector_all("#editor-tabs .editor-tab")
            tab_labels = [t.text_content().strip() for t in tabs]
            assert len(tabs) == 8, f"expected 8 tabs, found {tab_labels}"

            page.wait_for_selector("table.editor-table tbody tr.editor-row", timeout=15000)
            rows = page.query_selector_all("table.editor-table tbody tr.editor-row")
            assert len(rows) >= 100, f"expected 100+ pokemon rows, found {len(rows)}"

            first_row = rows[0]
            row_key = first_row.get_attribute("data-key")

            first_row.click()
            page.wait_for_selector(".editor-preview .playing-card", timeout=15000)
            page.screenshot(path=screenshot_path)
            print(f"screenshot: {screenshot_path}")

            page.click("[data-action='back']")
            page.wait_for_selector("table.editor-table tbody tr.editor-row", timeout=15000)

            cell_selector = f'tr.editor-row[data-key="{row_key}"] td[data-editable-col-key="baseHealth"]'
            original_text = page.text_content(cell_selector).strip()
            new_value = int(original_text) + 1

            page.click(cell_selector)
            page.fill(f"{cell_selector} input", str(new_value))
            page.press(f"{cell_selector} input", "Enter")
            page.wait_for_function(
                """(sel) => {
                    const cell = document.querySelector(sel);
                    return cell && !cell.classList.contains('is-saving') && !cell.querySelector('input');
                }""",
                arg=cell_selector,
                timeout=10000,
            )

            data = page.evaluate("() => fetch('/api/data').then((res) => res.json())")
            saved = next((p for p in data["pokemon"] if str(p["id"]) == row_key), None)
            assert saved is not None, f"pokemon id {row_key} not found after save"
            assert saved["baseHealth"] == new_value, (
                f"expected baseHealth {new_value} to round-trip, got {saved['baseHealth']}"
            )
        except Exception as exc:  # noqa: BLE001 - report, restore, exit non-zero below
            failure = str(exc)
        finally:
            git_restore("pokemon.json")
            browser.close()

    if failure:
        print(f"FAIL: {failure}", file=sys.stderr)
        return 1

    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1

    print(f"OK: 7 tabs, {len(rows)} pokemon rows, preview rendered, inline stat edit round-tripped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
