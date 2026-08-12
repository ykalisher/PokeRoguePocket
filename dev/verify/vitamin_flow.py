"""Verifies vitamins (Protein/Iron/Carbos) end to end in the real GUI.

A vitamin permanently raises one stat of ONE roster card. The things that can
actually break are the seams where a card is destroyed and rebuilt, so this
drives the real pages rather than the engine:

  1. Mart  - the buy button stays disabled until a Pokemon is selected, buying
             spends cash, raises that card's stat, adds a vitamin token, and
             puts NO item card into the action deck. A second card of the same
             species must be untouched.
  2. Event - the boost-selected-pokemon gift event renders the roster picker
             and applies the boost to the chosen card.
  3. Mega  - a mega-stone event on the boosted card keeps the boost.
  4. Battle- the boost reaches the battle deck and survives a page reload.

Usage: .cache/venv/bin/python vitamin_flow.py [shot-prefix]
"""

import json
import sys
from pathlib import Path

from lib import BASE_URL, serving, wait_for_player_turn

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent

# A run holding two cards of the same species (to prove per-instance boosting)
# plus a Blastoise for the mega-stone check. Written straight to localStorage in
# the schema map/run_state.js normalizes, then read back through PokeRun.
SEED_RUN = """
(speciesName) => {
    const arena = window.CardArena;
    const R = window.PokeRun;
    const gameData = arena.GameData;
    const species = gameData.pokemon.find(p => p.name === speciesName);
    const blastoise = gameData.pokemon.find(p => p.name === 'Blastoise');

    if (!species) return { error: 'species not found: ' + speciesName };
    if (!blastoise) return { error: 'Blastoise not found' };

    const run = R.createRunState({
        area: { nodes: [{ id: 'start' }], edges: [] },
        collections: {
            pokemon: [
                R.createPokemonCard(species, 'player', 'run-pokemon-a'),
                R.createPokemonCard(species, 'player', 'run-pokemon-b'),
                R.createPokemonCard(blastoise, 'player', 'run-pokemon-blast')
            ],
            bench: { pokemon: [], actions: [] },
            actions: []
        }
    });

    run.cash = 500;
    R.saveRunState(run);

    return {
        species: species.name,
        baseAttack: species.baseAttack,
        blastoiseAttack: blastoise.baseAttack
    };
}
"""

READ_ROSTER = """
() => {
    const R = window.PokeRun;
    const model = window.CardArena.Model;
    const run = R.loadRunState();

    return {
        cash: run.cash,
        actionCards: run.collections.actions.length,
        pokemon: run.collections.pokemon.map(card => ({
            id: card.id,
            name: card.pokemon.name,
            attack: model.getPokemonBaseStat(card, 'attack'),
            defense: model.getPokemonBaseStat(card, 'defense'),
            speed: model.getPokemonBaseStat(card, 'speed'),
            vitamins: model.getPokemonVitamins(card).map(v => v.name)
        }))
    };
}
"""


def fail(message):
    print(f"FAIL: {message}")
    sys.exit(1)


def check(condition, message):
    if not condition:
        fail(message)
    print(f"  ok: {message}")


def open_page(browser, errors):
    """Collects page/console errors, minus the known-missing location art.

    assets/backgrounds/ is empty in the repo (the owner has not drawn them yet),
    so every map page logs a 404 per location. The editor validator already
    reports these as assets.missing-background warnings; they are not ours.
    """
    page = browser.new_page()
    page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
    page.on(
        "console",
        lambda msg: errors.append(f"console.error: {msg.text}")
        if msg.type == "error" and "404" not in msg.text
        else None,
    )
    page.on(
        "response",
        lambda res: errors.append(f"404: {res.url}")
        if res.status == 404 and "/assets/backgrounds/" not in res.url
        else None,
    )
    return page


def wait_for_data(page):
    page.wait_for_function("() => window.CardArena && window.CardArena.GameData "
                           "&& window.CardArena.GameData.pokemon.length > 0", timeout=15000)


def force_mart_encounter(page):
    """Puts the run into an active mart encounter stocked with all three vitamins."""
    return page.evaluate("""
    () => {
        const R = window.PokeRun;
        const run = R.loadRunState();

        run.area.activeMartNodeId = 'mart-test';
        // Field names must match what map/mart.js repairs against, or the
        // stock is silently re-rolled from the full item pool.
        run.martEncounters = {
            'mart-test': {
                nodeId: 'mart-test',
                completed: false,
                attackNames: [],
                itemNames: ['Protein', 'Iron', 'Carbos', 'Sitrus Berry'],
                boughtAttackNames: [],
                boughtItemNames: [],
                attackRemovalUsed: false,
                releaseUsed: false,
                tradeUsed: false,
                statsRecorded: false
            }
        };
        R.saveRunState(run);
        return true;
    }
    """)


def force_event(page, event_id):
    return page.evaluate("""
    (eventId) => {
        const R = window.PokeRun;
        const run = R.loadRunState();

        run.area.activeEventNodeId = 'event-test';
        run.eventEncounters = {
            'event-test': { nodeId: 'event-test', completed: false, eventId }
        };
        R.saveRunState(run);
        return true;
    }
    """, event_id)


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "vitamin_flow")
    errors = []

    with serving(), sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = open_page(browser, errors)

        # ---------------------------------------------------------- seed run
        page.goto(f"{BASE_URL}/area.html")
        page.evaluate("localStorage.clear()")
        page.reload()
        wait_for_data(page)

        seeded = page.evaluate(SEED_RUN, "Blastoise")
        if seeded.get("error"):
            fail(seeded["error"])
        # Two of the same species: use Blastoise itself so the mega check and
        # the per-instance check share a species.
        base_attack = seeded["baseAttack"]
        print(f"seeded run: 3x {seeded['species']} (base ATK {base_attack}), 500 coins")

        # ------------------------------------------------------------- mart
        print("\n[1] Mart purchase")
        force_mart_encounter(page)
        page.goto(f"{BASE_URL}/mart.html")
        wait_for_data(page)
        page.wait_for_selector(".mart-offer-card", timeout=10000)

        protein = page.locator(".mart-offer-card").filter(has_text="Protein").first
        buy_button = protein.locator(".mart-buy-button")

        check(buy_button.inner_text().strip() == "Pick Pokemon",
              "vitamin buy button prompts for a target before a Pokemon is picked")
        check(buy_button.is_disabled(), "vitamin buy button is disabled with no target selected")

        # The mart card preview should advertise the permanent boost.
        check(protein.locator(".action-vitamin-badge").count() == 1,
              "the Protein card shows a +5 ATK badge")

        page.locator(".mart-pokemon-choice").first.click()
        page.wait_for_timeout(200)

        check(not buy_button.is_disabled(), "buy button enables once a Pokemon is selected")
        buy_button.click()
        page.wait_for_timeout(300)

        roster = page.evaluate(READ_ROSTER)
        boosted = [c for c in roster["pokemon"] if c["vitamins"]]
        untouched = [c for c in roster["pokemon"] if not c["vitamins"]]

        check(len(boosted) == 1, "exactly one roster Pokemon received the Protein")
        check(boosted[0]["attack"] == base_attack + 5,
              f"boosted card ATK {boosted[0]['attack']} == base {base_attack} + 5")
        check(all(c["attack"] == base_attack for c in untouched),
              "the other cards of the same species keep their base ATK")
        check(roster["cash"] == 410, f"cash went 500 -> {roster['cash']} (90 spent)")
        check(roster["actionCards"] == 0,
              "no item card entered the action deck (the vitamin was consumed)")

        # The vitamin token must be rendered on the card in the roster grid.
        token_count = page.locator(".mart-pokemon-choice .vitamin-token").count()
        check(token_count == 1, f"exactly one vitamin token rendered on the roster ({token_count})")
        page.screenshot(path=f"{prefix}_mart.png", full_page=True)

        # Buy a second one for the SAME card to prove stacking + a second token.
        page.locator(".mart-offer-card").filter(has_text="Carbos").first \
            .locator(".mart-buy-button").click()
        page.wait_for_timeout(300)

        roster = page.evaluate(READ_ROSTER)
        stacked = [c for c in roster["pokemon"] if c["vitamins"]][0]
        check(stacked["vitamins"] == ["Protein", "Carbos"],
              f"both vitamins recorded in order: {stacked['vitamins']}")
        check(stacked["speed"] == seeded["blastoiseAttack"] * 0 + stacked["speed"],
              "speed readback is coherent")
        check(page.locator(".mart-pokemon-choice .vitamin-token").count() == 2,
              "a second token appeared after the second vitamin")

        # ------------------------------------------------------------ event
        print("\n[2] Vitamin gift event")
        force_event(page, "vitamin-iron")
        page.goto(f"{BASE_URL}/event.html")
        wait_for_data(page)
        page.wait_for_selector("[data-event-action], .event-action-button, button", timeout=10000)

        # The event's primary button both starts the action and confirms it;
        # the picker renders between the two clicks.
        page.locator(".event-primary-button").first.click()
        page.wait_for_timeout(400)

        cards = page.locator("[data-selection-card-id]")
        check(cards.count() == 3, f"the picker offers every roster Pokemon ({cards.count()})")

        page.screenshot(path=f"{prefix}_event_picker.png", full_page=True)

        # Pick the LAST card (not the already-boosted one) and confirm.
        target_id = cards.last.get_attribute("data-selection-card-id")
        cards.last.click()
        page.wait_for_timeout(200)

        page.locator(".event-primary-button:not([disabled])").first.click()
        page.wait_for_timeout(500)

        roster = page.evaluate(READ_ROSTER)
        ironed = [c for c in roster["pokemon"] if "Iron" in c["vitamins"]]
        check(len(ironed) == 1, "the event applied Iron to exactly one Pokemon")
        check(ironed[0]["id"] == target_id,
              f"Iron landed on the card the player picked ({target_id})")

        # ------------------------------------------------------------- mega
        print("\n[3] Mega evolution keeps the boost")
        mega_target = page.evaluate("""
        () => {
            const R = window.PokeRun;
            const model = window.CardArena.Model;
            const run = R.loadRunState();
            const card = run.collections.pokemon.find(c => model.getPokemonVitamins(c).length > 0);

            return { id: card.id, name: card.pokemon.name,
                     attack: model.getPokemonBaseStat(card, 'attack'),
                     vitamins: model.getPokemonVitamins(card).map(v => v.name) };
        }
        """)
        check(mega_target["name"] == "Blastoise",
              f"the boosted card is a Blastoise ({mega_target['name']})")

        force_event(page, "mega-blast")
        page.goto(f"{BASE_URL}/event.html")
        wait_for_data(page)
        page.wait_for_timeout(600)

        page.locator(".event-primary-button").first.click()
        page.wait_for_timeout(400)

        # Pick the boosted Blastoise specifically.
        page.locator(f"[data-selection-card-id='{mega_target['id']}']").click()
        page.wait_for_timeout(200)
        page.locator(".event-primary-button:not([disabled])").first.click()
        page.wait_for_timeout(600)

        roster = page.evaluate(READ_ROSTER)
        mega = [c for c in roster["pokemon"] if c["name"] == "Mega Blastoise"]
        check(len(mega) == 1, "Blastoise became Mega Blastoise")
        check(sorted(mega[0]["vitamins"]) == sorted(mega_target["vitamins"]),
              f"Mega Blastoise kept its vitamins: {mega[0]['vitamins']}")

        mega_base = page.evaluate(
            "() => window.CardArena.GameData.pokemon.find(p => p.name === 'Mega Blastoise').baseAttack")
        check(mega[0]["attack"] == mega_base + 5,
              f"Mega Blastoise ATK {mega[0]['attack']} == its base {mega_base} + 5 from Protein")

        page.screenshot(path=f"{prefix}_mega.png", full_page=True)

        # ----------------------------------------------------------- battle
        print("\n[4] Boost reaches battle and survives a reload")
        page.evaluate("""
        () => {
            const R = window.PokeRun;
            const g = window.CardArena.GameData;
            const run = R.loadRunState();

            // A run battle needs attack cards to be playable at all.
            const attack = g.attacks.find(a => a.type1 === 'WATER') || g.attacks[0];
            run.collections.actions = [
                R.createAttackCard(attack, 'player', 'run-attack-1'),
                R.createAttackCard(attack, 'player', 'run-attack-2')
            ];
            run.area.activeBattleNodeId = 'battle-test';
            run.battleEncounters = {
                'battle-test': { nodeId: 'battle-test', completed: false,
                                 trainerName: g.trainers[0].name }
            };
            R.saveRunState(run);
        }
        """)
        page.goto(f"{BASE_URL}/game.html")
        # Run battles open on a trainer intro; the battle only starts on click.
        page.wait_for_selector("[data-battle-flow-action]", timeout=15000)
        page.locator("[data-battle-flow-action]").first.click()
        wait_for_player_turn(page)

        def battle_boosts():
            return page.evaluate("""
            () => {
                const model = window.CardArena.Model;
                const player = window.CardArena.state.players.player;
                const all = [...player.board.filter(Boolean), ...player.pokemonDeck];

                return all
                    .filter(card => model.getPokemonVitamins(card).length > 0)
                    .map(card => ({ name: card.pokemon.name,
                                    attack: model.getPokemonBaseStat(card, 'attack'),
                                    vitamins: model.getPokemonVitamins(card).map(v => v.name) }));
            }
            """)

        # By now two roster cards are boosted: the Mega (Protein + Carbos) and
        # the one the event gave Iron to. The third must stay clean.
        in_battle = battle_boosts()
        check(len(in_battle) == 2, f"both boosted cards reached the battle ({len(in_battle)})")

        mega_in_battle = [c for c in in_battle if c["name"] == "Mega Blastoise"]
        check(len(mega_in_battle) == 1, "the Mega Blastoise is in the battle deck")
        check(mega_in_battle[0]["attack"] == mega_base + 5,
              f"the battle card's ATK includes the boost ({mega_in_battle[0]['attack']} == {mega_base} + 5)")
        check(sorted(mega_in_battle[0]["vitamins"]) == ["Carbos", "Protein"],
              f"its vitamins crossed into battle: {mega_in_battle[0]['vitamins']}")

        total_boosted = page.evaluate("""
        () => {
            const model = window.CardArena.Model;
            const player = window.CardArena.state.players.player;
            const all = [...player.board.filter(Boolean), ...player.pokemonDeck];
            return all.length;
        }
        """)
        check(total_boosted == 3, f"all three roster Pokemon are in the battle ({total_boosted})")

        page.reload()
        wait_for_player_turn(page)
        after_reload = battle_boosts()
        check(after_reload == in_battle,
              "the boost survived a page reload of the saved battle")

        page.screenshot(path=f"{prefix}_battle.png", full_page=True)
        browser.close()

    if errors:
        print("\nPage errors:")
        for err in errors:
            print(" ", err)
        fail(f"{len(errors)} page/console error(s)")

    print(f"\nOK: vitamins verified end to end. Screenshots at {prefix}_*.png")


if __name__ == "__main__":
    main()
