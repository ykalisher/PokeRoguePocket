"""Phase 101 verification: the Music tab and MP3 uploads in the data editor.

Spawns `node dev/editor/server.js` on port 8933 (same pattern as
drive_editor.py / phase97_editor_achievements.py) and drives the new Music
tab end to end:

- the tab exists and starts empty (music.json ships as []);
- "+ Add track" -> fill id/title/category -> Save writes the record while its
  MP3 is still missing (music.missing-file is a warning on purpose, so the
  "save first, then upload" order works at all);
- the Upload button is disabled until an id is entered;
- uploading a tiny silent MP3 through the hidden file input writes
  assets/music/<id>.mp3, and the preview swaps its "no file uploaded yet"
  placeholder for an <audio> player;
- back in the list, the file dot for that row turns on;
- /api/issues reports music.empty-category warnings for the three categories
  still without an enabled track, and no music errors.

Restores music.json via `git checkout` and deletes the uploaded MP3 in a
finally block, so a failure never leaves the repo dirty.

Usage: .cache/venv/bin/python phase101_editor_music.py [screenshot.png]
Exits non-zero on any page error or failed assertion.
"""

import json
import sys
import tempfile
from pathlib import Path

from drive_editor import ROOT, git_clean, git_restore, serving_editor

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DATA = ROOT / "music.json"
MUSIC_DIR = ROOT / "assets" / "music"

TRACK_ID = "verify-gym-theme"
TRACK_FILE = MUSIC_DIR / f"{TRACK_ID}.mp3"

# One MPEG-1 Layer III frame (128kbps/44100Hz stereo, no CRC), payload zeroed
# out -> a valid, ~26ms silent MP3 (same fixture as phase100_battle_music.py).
SILENT_MP3 = bytes([0xFF, 0xFB, 0x90, 0x44]) + bytes(417 - 4)

PANEL = ".editor-tab-panel:not([hidden])"
ROWS = f"{PANEL} table.editor-table tbody tr.editor-row"


def main():
    screenshot_path = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "phase101_editor_music.png")

    if not git_clean("music.json"):
        print("FAIL: music.json has uncommitted changes before the smoke test even starts", file=sys.stderr)
        return 1
    if TRACK_FILE.exists():
        print(f"FAIL: {TRACK_FILE} already exists — refusing to clobber it", file=sys.stderr)
        return 1

    baseline = DATA.read_text()
    errors = []
    failure = None

    with tempfile.TemporaryDirectory() as tmp:
        upload_source = Path(tmp) / "verify.mp3"
        upload_source.write_bytes(SILENT_MP3)

        with serving_editor() as base_url, sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
            page.on(
                "console",
                lambda msg: errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
            )

            try:
                page.goto(f"{base_url}/")
                page.wait_for_selector('#editor-tabs .editor-tab[data-tab="music"]', timeout=15000)
                page.click('#editor-tabs .editor-tab[data-tab="music"]')
                page.wait_for_selector(f"{PANEL} [data-action='add-track']", timeout=15000)
                assert page.query_selector_all(ROWS) == [], "expected the shipped music.json to be empty"
                print("OK: the Music tab renders with an empty list")

                # --- 1. add a track; the Upload button waits for an id ---
                page.click("[data-action='add-track']")
                page.wait_for_selector('input[name="id"]', timeout=15000)
                assert page.is_disabled('[data-role="upload-music-btn"]'), "Upload must be disabled with no id"

                page.fill('input[name="id"]', TRACK_ID)
                page.fill('input[name="title"]', "Verify Gym Theme")
                page.select_option('select[name="category"]', "boss")
                assert not page.is_disabled('[data-role="upload-music-btn"]'), "Upload must enable once an id is set"
                print("OK: the Upload button is disabled without an id and enables once one is entered")

                page.click('[data-action="set-canonical-file"]')
                page.click('[data-action="save"]')
                page.wait_for_timeout(500)

                saved = json.loads(DATA.read_text())
                assert len(saved) == 1, f"expected exactly one saved track, got {saved}"
                assert saved[0] == {
                    "id": TRACK_ID,
                    "title": "Verify Gym Theme",
                    "category": "boss",
                    "file": f"assets/music/{TRACK_ID}.mp3",
                    "enabled": True,
                }, f"unexpected saved record: {saved[0]}"
                print("OK: saving before the upload works and writes the locked record shape")

                # --- 2. the preview says the file is missing, then plays it ---
                placeholder = page.text_content(".editor-music-placeholder")
                assert "no file uploaded yet" in placeholder, f"expected the missing-file placeholder, got {placeholder!r}"

                page.set_input_files('[data-role="upload-music-input"]', str(upload_source))
                page.wait_for_selector("audio.editor-music-player", timeout=15000)

                assert TRACK_FILE.exists(), f"expected {TRACK_FILE} to be written"
                assert TRACK_FILE.read_bytes() == SILENT_MP3, "uploaded bytes must land byte-for-byte"
                src = page.get_attribute("audio.editor-music-player", "src")
                assert src.endswith(f"assets/music/{TRACK_ID}.mp3"), f"unexpected audio src {src!r}"
                print("OK: uploading the MP3 writes assets/music/<id>.mp3 and the preview becomes an <audio> player")

                page.screenshot(path=screenshot_path)
                print(f"screenshot: {screenshot_path}")

                # --- 3. the list's file dot turns on ---
                page.click('[data-action="back"]')
                page.wait_for_selector(ROWS, timeout=15000)
                row = page.query_selector(f'{ROWS}[data-key="{TRACK_ID}"]')
                assert row is not None, "expected the new track in the list"
                cells = row.query_selector_all("td")
                assert "Gym Leaders" in cells[2].text_content(), f"expected the UI category label, got {cells[2].text_content()!r}"
                assert "editor-dot--on" in cells[3].inner_html(), "expected the file dot to be on after the upload"
                assert "editor-dot--on" in cells[4].inner_html(), "expected the enabled dot to be on"
                print("OK: the list row shows the 'Gym Leaders' label with the file and enabled dots on")

                # --- 4. issues: empty-category warnings, no music errors ---
                issues = page.evaluate("() => fetch('/api/issues').then((res) => res.json())")
                music_issues = [i for i in issues["issues"] if i["file"] == "music.json"]
                empty = [i for i in music_issues if i["code"] == "music.empty-category"]
                assert len(empty) == 3, f"expected 3 empty-category warnings with boss covered, got {empty}"
                assert all(i["severity"] == "warning" for i in music_issues), f"music issues must all be warnings, got {music_issues}"
                print("OK: /api/issues reports the empty-category warnings and no music errors")

            except Exception as exc:  # noqa: BLE001 - report, restore, exit non-zero below
                failure = f"{type(exc).__name__}: {exc}"
            finally:
                git_restore("music.json")
                TRACK_FILE.unlink(missing_ok=True)
                browser.close()

    if DATA.read_text() != baseline:
        failure = failure or "music.json was not restored to baseline"
    if TRACK_FILE.exists():
        failure = failure or f"{TRACK_FILE} was left behind"

    if failure:
        print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1

    print("OK: Music tab list, save-then-upload flow, MP3 upload, inline preview and issue reporting all verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
