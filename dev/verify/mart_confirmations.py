"""Mart confirmation dialogs for the three destructive services.

(a) Release: clicking Release opens a dialog picturing the selected pokemon.
    Cancel changes nothing (roster intact, service still available); Confirm
    releases exactly that pokemon.
(b) Remove attack: picking a card in the picker opens a dialog picturing that
    attack. Cancel returns to the picker with no charge; Confirm removes it.
(c) Trade: clicking Trade opens a dialog picturing both the pokemon given away
    and the one received. Cancel changes nothing; Confirm performs the swap.
(d) Escape closes an open confirmation without applying it.

Usage: .cache/venv/bin/python mart_confirmations.py [shot_prefix] [viewport_width]
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"

SHOP_GRAPH_JS = """() => {
    const run = JSON.parse(localStorage.getItem('%s'));
    run.area.graph = {
        columns: [],
        edges: [{ from: 'start', to: 'shop-1' }],
        nodes: [
            { id: 'start', lane: 2, step: 0, type: 'start', x: 5, y: 30 },
            { id: 'shop-1', lane: 2, step: 1, type: 'shop', x: 50, y: 30 }
        ]
    };
    run.area.currentNodeId = 'start';
    run.area.visitedNodeIds = ['start'];
    run.area.traveledPathKeys = [];
    run.area.activeMartNodeId = null;
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)

# Six distinct species (distinct names keep the roster assertions unambiguous,
# and >=4 pokemon are needed before the release service unlocks). Picked by
# walking the live pokemon list rather than naming records.
SET_ROSTER_JS = """(count) => {
    const gameData = window.CardArena.GameData;
    const seen = new Set();
    const pool = gameData.pokemon.filter(record => {
        const types = [record.type1, record.type2, record.type3];
        if (types.includes('LEGENDARY') || types.includes('BABY')) return false;
        if (seen.has(record.name)) return false;
        seen.add(record.name);
        return true;
    });
    const step = Math.max(1, Math.floor(pool.length / count));
    const records = [];
    for (let index = 0; records.length < count && index < pool.length; index += step) {
        records.push(pool[index]);
    }
    const run = JSON.parse(localStorage.getItem('%s'));
    run.collections.pokemon = records.map((record, index) => ({
        currentHealth: record.baseHealth,
        currentStatus: [],
        faceUp: true,
        hasUsedFossilRevival: false,
        id: `verify-pkmn-${index}`,
        kind: 'pokemon',
        owner: 'player',
        pokemon: record,
        statStages: { attack: 0, defense: 0, speed: 0 }
    }));
    run.collections.bench.pokemon = [];
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)


def get_run(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))


def pokemon_names(page):
    run = get_run(page)
    cards = run["collections"]["pokemon"] + run["collections"]["bench"]["pokemon"]
    return sorted(card["pokemon"]["name"] for card in cards)


def attack_names(page):
    run = get_run(page)
    cards = run["collections"]["actions"] + run["collections"]["bench"]["actions"]
    return sorted(card["attack"]["name"] for card in cards if card["kind"] == "attack")


def dialog_card_names(page):
    return page.eval_on_selector_all(
        ".mart-confirm-card", "cards => cards.map(card => card.getAttribute('aria-label'))"
    )


def dialog_open(page):
    return page.query_selector("[data-mart-confirm-overlay]") is not None


def start_run(page, base):
    page.goto(f"{base}/starter.html")
    page.wait_for_selector(".starter-card[data-starter='water']")
    page.evaluate("localStorage.clear()")
    page.click(".starter-card[data-starter='water']")
    page.wait_for_function(
        "() => location.pathname.endsWith('area.html') && localStorage.getItem('%s')" % RUN_KEY,
        timeout=15000,
    )
    page.evaluate(SHOP_GRAPH_JS)
    page.evaluate(SET_ROSTER_JS, 6)
    page.reload()
    page.wait_for_selector("[data-node-id='shop-1']")
    page.click("[data-node-id='shop-1']")
    page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
    page.wait_for_selector(".mart-service-row")


def check(ok, condition, message):
    if condition:
        return ok

    print("FAIL:", message)
    return False


def main():
    shot_prefix = sys.argv[1] if len(sys.argv) > 1 else None
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": width, "height": 900})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        start_run(page, base)

        # ---------------------------------------------------------------- (a)
        selected = page.query_selector(".mart-pokemon-choice[data-pokemon-card-id]")
        selected_name = selected.get_attribute("aria-label").replace("Select ", "")
        selected.click()
        before_names = pokemon_names(page)

        page.click("[data-mart-service='release']")
        page.wait_for_selector("[data-mart-confirm-overlay]")
        pictured = dialog_card_names(page)
        print(f"(a) release dialog pictures {pictured} for {selected_name!r}")
        ok = check(ok, pictured == [selected_name],
                   f"release dialog should picture {selected_name!r}, showed {pictured}")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_release.png")

        page.click("[data-cancel-mart-confirm]")
        page.wait_for_selector("[data-mart-confirm-overlay]", state="detached")
        release_button = page.query_selector("[data-mart-service='release']")
        print(f"(a) after cancel: roster={pokemon_names(page) == before_names} "
              f"button={release_button.text_content().strip()!r}")
        ok = check(ok, pokemon_names(page) == before_names,
                   "cancelling the release dialog should leave the roster unchanged")
        ok = check(ok, not release_button.is_disabled() and release_button.text_content().strip() == "Release",
                   "cancelling should leave the release service available")

        page.click("[data-mart-service='release']")
        page.wait_for_selector("[data-mart-confirm-overlay]")
        page.click("[data-resolve-mart-confirm]")
        page.wait_for_selector("[data-mart-confirm-overlay]", state="detached")
        after_names = pokemon_names(page)
        expected_names = sorted(before_names)
        expected_names.remove(selected_name)
        print(f"(a) after confirm: {before_names} -> {after_names}")
        ok = check(ok, after_names == expected_names,
                   f"confirming should release exactly {selected_name!r}, got {after_names}")

        # ---------------------------------------------------------------- (b)
        before_cash = get_run(page)["cash"]
        before_attacks = attack_names(page)
        page.click("[data-mart-service='remove-attack']")
        page.wait_for_selector("[data-attack-removal-overlay]")
        choice = page.query_selector("[data-remove-attack-id]")
        choice_name = choice.get_attribute("aria-label").replace("Remove ", "")
        choice.click()
        page.wait_for_selector("[data-mart-confirm-overlay]")
        pictured = dialog_card_names(page)
        print(f"(b) removal dialog pictures {pictured} for {choice_name!r}")
        ok = check(ok, pictured == [choice_name],
                   f"removal dialog should picture {choice_name!r}, showed {pictured}")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_remove_attack.png")

        page.click("[data-cancel-mart-confirm]")
        page.wait_for_selector("[data-mart-confirm-overlay]", state="detached")
        back_in_picker = page.query_selector("[data-attack-removal-overlay]") is not None
        print(f"(b) after cancel: cash={get_run(page)['cash']} picker_open={back_in_picker}")
        ok = check(ok, get_run(page)["cash"] == before_cash,
                   "cancelling the removal dialog should not charge any coins")
        ok = check(ok, attack_names(page) == before_attacks,
                   "cancelling the removal dialog should keep every attack")
        ok = check(ok, back_in_picker, "cancelling should drop back to the attack picker")

        page.click(f"[data-remove-attack-id][aria-label='Remove {choice_name}']")
        page.wait_for_selector("[data-mart-confirm-overlay]")
        page.click("[data-resolve-mart-confirm]")
        page.wait_for_selector("[data-mart-confirm-overlay]", state="detached")
        expected_attacks = list(before_attacks)
        expected_attacks.remove(choice_name)
        print(f"(b) after confirm: cash={get_run(page)['cash']} attacks={attack_names(page)}")
        ok = check(ok, attack_names(page) == sorted(expected_attacks),
                   f"confirming should remove exactly {choice_name!r}, got {attack_names(page)}")
        ok = check(ok, get_run(page)["cash"] == before_cash - 50,
                   "confirming the removal should charge 50 coins")
        ok = check(ok, page.query_selector("[data-attack-removal-overlay]") is None,
                   "confirming the removal should close the picker")

        # ---------------------------------------------------------------- (c)
        trades = get_run(page)["martEncounters"]["shop-1"]["trades"]
        traded_index = None
        traded_name = None
        # The panel re-renders on every selection, so drive it by selector.
        owned = pokemon_names(page)
        for index in range(len(trades)):
            for name in owned:
                page.click(f"[aria-label='Select {name}']")
                enabled = page.eval_on_selector(
                    f"[data-mart-service='trade'][data-trade-index='{index}']", "button => !button.disabled"
                )
                if enabled:
                    traded_index, traded_name = index, name
                    break
                page.click(f"[aria-label='Select {name}']")  # deselect
            if traded_index is not None:
                break

        if traded_index is None:
            print("(c) SKIP: no owned pokemon matches either rolled trade offer")
        else:
            offered_name = trades[traded_index]["offeredName"]
            before_names = pokemon_names(page)
            page.click(f"[data-mart-service='trade'][data-trade-index='{traded_index}']")
            page.wait_for_selector("[data-mart-confirm-overlay]")
            pictured = dialog_card_names(page)
            print(f"(c) trade dialog pictures {pictured} ({traded_name!r} -> {offered_name!r})")
            ok = check(ok, pictured == [traded_name, offered_name],
                       f"trade dialog should picture [{traded_name!r}, {offered_name!r}], showed {pictured}")
            if shot_prefix:
                page.screenshot(path=f"{shot_prefix}_trade.png")

            # (d) Escape dismisses without applying.
            page.keyboard.press("Escape")
            page.wait_for_selector("[data-mart-confirm-overlay]", state="detached")
            print(f"(d) after Escape: roster unchanged={pokemon_names(page) == before_names}")
            ok = check(ok, pokemon_names(page) == before_names,
                       "Escape on the trade dialog should leave the roster unchanged")
            ok = check(ok, not get_run(page)["martEncounters"]["shop-1"]["trades"][traded_index]["used"],
                       "Escape on the trade dialog should leave the offer unused")

            page.click(f"[data-mart-service='trade'][data-trade-index='{traded_index}']")
            page.wait_for_selector("[data-mart-confirm-overlay]")
            page.click("[data-resolve-mart-confirm]")
            page.wait_for_selector("[data-mart-confirm-overlay]", state="detached")
            after_names = pokemon_names(page)
            print(f"(c) after confirm: {before_names} -> {after_names}")
            ok = check(ok, traded_name not in after_names,
                       f"confirming should trade {traded_name!r} away")
            ok = check(ok, offered_name in after_names,
                       f"confirming should hand back {offered_name!r}")
            ok = check(ok, len(after_names) == len(before_names),
                       "a trade should keep the roster size unchanged")

        ok = check(ok, not dialog_open(page), "no confirmation dialog should be left open")

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
