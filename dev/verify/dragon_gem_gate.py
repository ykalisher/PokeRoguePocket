"""Dragon-gem gate verification: a gem only reaches the action deck when the run
owns a DRAGON attack that damages opponents.

Dragon Dance (DRAGON, target SELF, 0 power) must NOT qualify a run, because the
battle engine only applies a gem's paired status to a damaging DRAGON attack
(getDragonGemStatusesForAttack in arena/arena_controller.js). Dragon Claw must.

Seeds a run with a DRAGON pokemon plus one dragon attack, forces a trivial
start -> shop graph, and samples fresh mart stock many times over.

Usage: .cache/venv/bin/python dragon_gem_gate.py [shot.png]
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"
MART_SAMPLES = 25

FORCE_SHOP_GRAPH_JS = """() => {
    const run = JSON.parse(localStorage.getItem('%s'));
    run.area.graph = {
        columns: [],
        edges: [{ from: 'start', to: 'shop-1' }],
        nodes: [
            { id: 'start', lane: 2, step: 0, type: 'start', x: 5, y: 50 },
            { id: 'shop-1', lane: 2, step: 1, type: 'shop', x: 50, y: 50 }
        ]
    };
    run.area.currentNodeId = 'start';
    run.area.visitedNodeIds = ['start'];
    run.area.traveledPathKeys = [];
    run.area.activeMartNodeId = null;
    run.martEncounters = {};
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)

# Swap the run's roster for a DRAGON pokemon plus a single named dragon attack,
# picked out of live game data so no species/attack name is hardcoded here
# beyond the one attack under test.
SEED_RUN_JS = """(attackName) => {
    const run = JSON.parse(localStorage.getItem('%s'));
    const gd = window.CardArena.GameData;
    const typesOf = r => Array.isArray(r.types) ? r.types
        : [r.type1, r.type2, r.type3].filter(t => t && t !== 'NONE');
    const mon = gd.pokemon.find(p => typesOf(p).includes('DRAGON'));
    const atk = gd.attacks.find(a => a.name === attackName);
    if (!mon || !atk) return null;

    run.collections.pokemon = [window.PokeRun.createPokemonCard(mon, 'player', 'seed-mon')];
    run.collections.bench.pokemon = [];
    run.collections.actions = [window.PokeRun.createAttackCard(atk, 'player', 'seed-atk')];
    run.collections.bench.actions = [];
    run.cash = 9999;
    run.martEncounters = {};
    run.area.activeMartNodeId = null;
    localStorage.setItem('%s', JSON.stringify(run));
    return { pokemon: mon.name, attack: atk.name };
}""" % (RUN_KEY, RUN_KEY)

GEM_NAMES_JS = """() => window.CardArena.GameData.items
    .filter(i => Array.isArray(i.status) && i.status.includes('DRAGON_GEM'))
    .map(i => i.name)"""


def offer_names(page):
    return page.eval_on_selector_all(
        ".mart-offer-card .playing-card", "els => els.map(el => el.getAttribute('aria-label'))"
    )


def sample_mart(page, base, gems, samples):
    """Walk into the shop `samples` times with fresh stock; return the gems seen.

    Stock is rolled by area.js when the shop node is clicked, so each sample has
    to reset the graph and re-enter rather than reloading mart.html directly.
    """
    seen = set()
    for _ in range(samples):
        page.goto(f"{base}/area.html")
        page.wait_for_function("() => window.CardArena.GameData", timeout=15000)
        page.evaluate(FORCE_SHOP_GRAPH_JS)
        page.reload()
        page.wait_for_selector("[data-node-id='shop-1']")
        page.click("[data-node-id='shop-1']")
        page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
        page.wait_for_selector(".mart-offer-card")
        seen.update(n for n in offer_names(page) if n in gems)
    return seen


def main():
    shot = sys.argv[1] if len(sys.argv) > 1 else None
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # console 404s (missing location backgrounds) are a known pre-existing
        # gap; only real page JS errors fail the run.
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='water']")
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='water']")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
            timeout=15000,
        )
        page.evaluate(FORCE_SHOP_GRAPH_JS)

        gems = set(page.evaluate(GEM_NAMES_JS))
        print(f"dragon-gem items in data: {sorted(gems)}")
        if not gems:
            print("FAIL: no dragon-gem items found, nothing to verify")
            browser.close()
            sys.exit(1)

        # --- the page-level predicate, on the capture page that now calls it ---
        page.goto(f"{base}/capture.html")
        page.wait_for_function("() => window.PokeLocations && window.CardArena.GameData", timeout=15000)
        classified = page.evaluate("""() => window.CardArena.GameData.attacks
            .filter(a => [a.type1, a.type2].includes('DRAGON'))
            .map(a => ({
                name: a.name,
                target: a.target,
                power: a.basePower,
                enables: window.PokeLocations.attackEnablesDragonGem(a)
            }))""")
        print("capture.html PokeLocations.attackEnablesDragonGem:")
        for row in classified:
            print(f"  {'YES' if row['enables'] else 'no '}  {row['name']:<20}{row['target']:<16}{row['power']}")
        for row in classified:
            expected = row["target"] in ("OPPONENT", "ALL_OPPONENTS") and row["power"] > 0
            if row["enables"] != expected:
                ok = False
                print(f"FAIL: {row['name']} classified {row['enables']}, expected {expected}")
        if not any(r["enables"] for r in classified) or all(r["enables"] for r in classified):
            ok = False
            print("FAIL: the dragon attack set must contain both qualifying and non-qualifying moves")

        # --- Dragon Dance only: gems must never stock ---
        page.goto(f"{base}/area.html")
        page.wait_for_function("() => window.CardArena.GameData", timeout=15000)
        seeded = page.evaluate(SEED_RUN_JS, "Dragon Dance")
        print(f"\nseeded run: {seeded} (DRAGON pokemon, self-buff dragon attack only)")
        dance_gems = sample_mart(page, base, gems, MART_SAMPLES)
        print(f"gems seen over {MART_SAMPLES} fresh marts: {sorted(dance_gems) or 'none'}")
        if dance_gems:
            ok = False
            print(f"FAIL: gems stocked for a Dragon-Dance-only run: {sorted(dance_gems)}")

        # --- Dragon Claw: gems must still stock, else the test proves nothing ---
        page.goto(f"{base}/area.html")
        page.wait_for_function("() => window.CardArena.GameData", timeout=15000)
        seeded = page.evaluate(SEED_RUN_JS, "Dragon Claw")
        print(f"\nseeded run: {seeded} (DRAGON pokemon, damaging dragon attack)")
        claw_gems = sample_mart(page, base, gems, MART_SAMPLES)
        print(f"gems seen over {MART_SAMPLES} fresh marts: {sorted(claw_gems) or 'none'}")
        if not claw_gems:
            ok = False
            print("FAIL: no gems stocked for a run that qualifies -- the gate is too strict")

        if shot:
            page.goto(f"{base}/mart.html")
            page.wait_for_selector(".mart-offer-card")
            page.screenshot(path=shot)

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
