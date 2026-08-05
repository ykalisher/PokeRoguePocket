import json, shutil, sys, time
from pathlib import Path
from lib import serving, sync_playwright, ROOT

DATA = ROOT / "starter_decks.json"
ORIG = DATA.read_text()
SHOT = Path(__file__).parent


def deck_ids(page):
    return [c.get_attribute("data-starter") for c in page.query_selector_all(".starter-card")]


def overflow(page):
    return page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")


ok = True
try:
    with serving() as base, sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # --- fixture: a fourth deck ---
        four = json.loads(ORIG)
        four.append({
            "id": "electric", "name": "Electric", "type": "ELECTRIC",
            "pokemon": ["Raichu"],
            "attacks": [{"name": "Thunder Bolt", "count": 2}],
            "items": [{"name": "Sitrus Berry", "count": 1}],
            "enabled": True,
        })
        DATA.write_text(json.dumps(four, indent=2) + "\n"); time.sleep(1.5)
        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='electric']", timeout=15000)
        ids = deck_ids(page)
        print("4 decks ->", ids, "h-overflow:", overflow(page))
        page.screenshot(path=str(SHOT / "phase89_four_decks.png"), full_page=True)
        if ids != ["water", "grass", "fire", "electric"] or overflow(page):
            ok = False

        # --- fixture: disabled deck ---
        disabled = json.loads(ORIG)
        disabled[1]["enabled"] = False
        DATA.write_text(json.dumps(disabled, indent=2) + "\n"); time.sleep(1.5)
        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card", timeout=15000)
        ids = deck_ids(page)
        print("grass disabled ->", ids)
        page.screenshot(path=str(SHOT / "phase89_disabled_deck.png"), full_page=True)
        if ids != ["water", "fire"]:
            ok = False

        # restore before the file:// check so it reads the real three
        DATA.write_text(ORIG); time.sleep(1.5)

        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card", timeout=15000)
        print("restored ->", deck_ids(page))
        if deck_ids(page) != ["water", "grass", "fire"]:
            ok = False
        page.screenshot(path=str(SHOT / "phase89_starter.png"), full_page=True)

        # --- file:// fallback (fetch fails, fallbackRecords.starterDecks used) ---
        warns = []
        page.on("console", lambda m: warns.append(m.text) if m.type == "warning" else None)
        page.goto(f"file://{ROOT}/starter.html")
        page.wait_for_selector(".starter-card", timeout=15000)
        ids = deck_ids(page)
        print("file:// ->", ids)
        print("file:// fallback warning present:",
              any("starter_decks.json fallback" in w for w in warns))
        page.screenshot(path=str(SHOT / "phase89_file_protocol.png"), full_page=True)
        if ids != ["water", "grass", "fire"]:
            ok = False

        if errors:
            ok = False
            print("PAGE ERRORS:", errors)
        b.close()
finally:
    DATA.write_text(ORIG)

print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
