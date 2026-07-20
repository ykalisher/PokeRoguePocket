"""Phase 4 verification: starter picker -> fresh run collections + L1 location.

Usage: .cache/venv/bin/python drive_starter.py [shot.png]
"""

import json
import sys

from lib import serving, sync_playwright

EXPECTED = {
    "fire": {
        "type": "FIRE",
        "pokemon": ["Charizard", "Typhlosion"],
        "attacks": {"Flame Thrower": 2, "Fire Spin": 2, "Air Slash": 1, "Shadow Ball": 1},
        "items": {"Sitrus Berry": 1, "Withdraw Wand": 1},
    },
    "water": {
        "type": "WATER",
        "pokemon": ["Blastoise", "Feraligatr"],
        "attacks": {"Surf": 2, "Waterfall": 2, "Crunch": 1, "Sucker Punch": 1},
        "items": {"Sitrus Berry": 1, "Withdraw Wand": 1},
    },
    "grass": {
        "type": "GRASS",
        "pokemon": ["Venusaur", "Meganium"],
        "attacks": {"Razor Leaf": 3, "Sleep Powder": 1, "Sludge Bomb": 1, "Moonblast": 1},
        "items": {"Sitrus Berry": 1, "Withdraw Wand": 1},
    },
}

RUN_KEY = "pokemon-rogue-pocket-run"


def counts(names):
    out = {}
    for name in names:
        out[name] = out.get(name, 0) + 1
    return out


def check_run(run, expected, real):
    """real: {'pokemon': {name: record}, 'attacks': {...}, 'items': {...}} from
    the page's live arena.GameData. Each embedded card record must deep-equal its
    real record — a silent fallback stub would differ."""
    problems = []
    loc_types = run.get("location", {}).get("types", [])
    if expected["type"] not in loc_types:
        problems.append(f"L1 location types {loc_types} missing {expected['type']}")

    col = run.get("collections", {})
    pokemon_cards = col.get("pokemon", []) + col.get("bench", {}).get("pokemon", [])
    action_cards = col.get("actions", []) + col.get("bench", {}).get("actions", [])

    got_pokemon = sorted(c["pokemon"]["name"] for c in pokemon_cards)
    if got_pokemon != sorted(expected["pokemon"]):
        problems.append(f"pokemon {got_pokemon} != {sorted(expected['pokemon'])}")

    attacks = counts(c["attack"]["name"] for c in action_cards if c.get("kind") == "attack")
    items = counts(c["item"]["name"] for c in action_cards if c.get("kind") == "item")
    if attacks != expected["attacks"]:
        problems.append(f"attacks {attacks} != {expected['attacks']}")
    if items != expected["items"]:
        problems.append(f"items {items} != {expected['items']}")

    for c in pokemon_cards:
        if c["pokemon"] != real["pokemon"].get(c["pokemon"]["name"]):
            problems.append(f"non-real pokemon record {c['pokemon']['name']}")
    for c in action_cards:
        if c.get("kind") == "attack" and c["attack"] != real["attacks"].get(c["attack"]["name"]):
            problems.append(f"non-real attack record {c['attack']['name']}")
        if c.get("kind") == "item" and c["item"] != real["items"].get(c["item"]["name"]):
            problems.append(f"non-real item record {c['item']['name']}")
    return problems


def real_records(page):
    return page.evaluate("""() => {
        const gd = window.CardArena.GameData;
        const byName = list => Object.fromEntries((list || []).map(r => [r.name, r]));
        return { pokemon: byName(gd.pokemon), attacks: byName(gd.attacks), items: byName(gd.items) };
    }""")


def main():
    shot = sys.argv[1] if len(sys.argv) > 1 else None
    errors = []
    ok = True
    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

        # 1. starter page renders 3 cards.
        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
        cards = page.query_selector_all(".starter-card")
        print(f"starter cards rendered: {len(cards)}")
        if len(cards) != 3:
            ok = False
        if shot:
            page.screenshot(path=shot)

        # 2. pick each starter, verify the resulting run.
        for starter, expected in EXPECTED.items():
            page.goto(f"{base}/starter.html")
            page.wait_for_selector(f".starter-card[data-starter='{starter}']")
            page.evaluate("localStorage.clear()")  # avoid reading the previous run's blob
            page.click(f".starter-card[data-starter='{starter}']")
            page.wait_for_function(
                "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
                timeout=15000,
            )
            run = json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))
            problems = check_run(run, expected, real_records(page))
            search = page.evaluate("location.search")
            if search:
                problems.append(f"URL still has query {search!r}")
            print(f"[{starter}] starterId={run.get('starterId')} level={run.get('level')} "
                  f"loc={run.get('location',{}).get('name')} types={run.get('location',{}).get('types')} "
                  f"-> {'OK' if not problems else problems}")
            if problems:
                ok = False

        # 3. no starter param -> water fallback.
        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card")
        page.evaluate("localStorage.clear()")
        page.goto(f"{base}/area.html?newRun=1")
        page.wait_for_function(
            "() => localStorage.getItem('pokemon-rogue-pocket-run')", timeout=15000)
        run = json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))
        fallback_ok = run.get("starterId") == "water"
        print(f"[no-param] starterId={run.get('starterId')} -> {'OK' if fallback_ok else 'FAIL'}")
        if not fallback_ok:
            ok = False

        browser.close()

    if errors:
        ok = False
        print("PAGE ERRORS:")
        for e in errors:
            print(" ", e)

    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
