"""Verification: one achievement per starter deck.

1. achievements.html with an empty profile lists every enabled achievement,
   including one per enabled starter deck, all locked at 0 / 1.
2. Applying the exact bump arena/game.js makes on a run victory
   (runs.completed.starter.<id>) unlocks only that deck's achievement.
3. Reloading achievements.html shows it unlocked, toasts it once, and leaves
   every other starter achievement locked.

Usage: .cache/venv/bin/python starter_deck_achievements.py [shot.png]
"""

import json
import sys
from pathlib import Path

from lib import serving, sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

PROFILE_KEY = "pokemon-rogue-pocket-profile"
DECK_ID = "dragon"

RECORD_VICTORY = """(deckId) => {
    // Exactly what finalizeRunVictory() in arena/game.js does.
    const unlocked = window.PokeProfile.record(
        { 'runs.completed': 1, ['runs.completed.starter.' + deckId]: 1 },
        window.CardArena.GameData.achievements
    );
    return unlocked.map(entry => entry.id);
}"""


def check(problems, ok, message):
    print(("  OK   " if ok else "  FAIL ") + message)
    if not ok:
        problems.append(message)


def rows(page):
    return page.evaluate("""() => Array.from(document.querySelectorAll('.achievement-row')).map(row => ({
        name: row.querySelector('.achievement-name').textContent.trim(),
        description: row.querySelector('.achievement-description').textContent.trim(),
        unlocked: row.classList.contains('achievement-row--unlocked'),
        progress: (row.querySelector('.achievement-progress-label') || {}).textContent || ''
    }))""")


def main():
    shot = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    problems = []
    errors = []

    decks = [d for d in json.loads((ROOT / "starter_decks.json").read_text())
             if d.get("enabled") is not False]
    achievements = [a for a in json.loads((ROOT / "achievements.json").read_text())
                    if a.get("enabled") is not False]
    by_stat = {a["stat"]: a for a in achievements}

    with serving() as base, sync_playwright() as play:
        browser = play.chromium.launch()
        page = browser.new_page(viewport={"width": 900, "height": 1200})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(base + "/achievements.html")
        page.evaluate("key => localStorage.removeItem(key)", PROFILE_KEY)
        page.goto(base + "/achievements.html")
        page.wait_for_selector(".achievement-row")

        print("1. every enabled starter deck has a locked achievement")
        listed = rows(page)
        check(problems, len(listed) == len(achievements),
              "page lists every enabled achievement (%d of %d)" % (len(listed), len(achievements)))
        check(problems, page.inner_text("#achievement-count") == "0 / %d" % len(achievements),
              "header count reads 0 / %d (got %r)" % (len(achievements), page.inner_text("#achievement-count")))

        for deck in decks:
            record = by_stat.get("runs.completed.starter." + deck["id"])
            if record is None:
                check(problems, False, "%s deck has an achievement" % deck["id"])
                continue
            row = next((r for r in listed if r["name"] == record["name"]), None)
            check(problems, row is not None and not row["unlocked"] and row["progress"] == "0 / 1",
                  "%s deck -> %r renders locked at 0 / 1" % (deck["id"], record["name"]))

        print("2. a run victory with the %s deck unlocks only its achievement" % DECK_ID)
        unlocked_ids = page.evaluate(RECORD_VICTORY, DECK_ID)
        expected = {"champion", "starter-" + DECK_ID}
        check(problems, set(unlocked_ids) == expected,
              "record() unlocked exactly %s (got %s)" % (sorted(expected), sorted(unlocked_ids)))

        print("3. the page reflects the unlock and toasts it once")
        page.goto(base + "/achievements.html")
        page.wait_for_selector(".achievement-row")
        page.wait_for_timeout(400)

        after = rows(page)
        target = by_stat["runs.completed.starter." + DECK_ID]["name"]
        unlocked_names = {r["name"] for r in after if r["unlocked"]}
        check(problems, target in unlocked_names, "%r shows unlocked" % target)

        other_starters = {by_stat["runs.completed.starter." + d["id"]]["name"]
                          for d in decks if d["id"] != DECK_ID
                          and "runs.completed.starter." + d["id"] in by_stat}
        check(problems, not (other_starters & unlocked_names),
              "no other starter achievement unlocked (%s)" % sorted(other_starters & unlocked_names))
        check(problems, page.inner_text("#achievement-count") == "2 / %d" % len(achievements),
              "header count reads 2 / %d (got %r)" % (len(achievements), page.inner_text("#achievement-count")))

        toasts = page.eval_on_selector_all(".achievement-toast .achievement-toast-name",
                                           "nodes => nodes.map(n => n.textContent.trim())")
        check(problems, target in toasts, "%r toasted on load (got %s)" % (target, toasts))

        if shot:
            page.screenshot(path=str(shot), full_page=True)
            print("  screenshot -> %s" % shot)

        page.goto(base + "/achievements.html")
        page.wait_for_selector(".achievement-row")
        page.wait_for_timeout(400)
        again = page.eval_on_selector_all(".achievement-toast", "nodes => nodes.length")
        check(problems, again == 0, "no toast on the second load (got %d)" % again)

        browser.close()

    check(problems, not errors, "no page/console errors (%s)" % errors[:3])

    print("RESULT: %s" % ("PASS" if not problems else "FAIL (%d problems)" % len(problems)))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
