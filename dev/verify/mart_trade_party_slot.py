"""Mart trade keeps the incoming pokemon in the slot the outgoing one held.

(a) Trading a party member: the pokemon handed back lands in that exact active
    slot, the party size is unchanged, and no benched pokemon is promoted.
(b) The action deck is re-sorted for the new party: every attack in the deck is
    playable by an active pokemon, every benched attack is not.
(c) Trading a benched pokemon keeps the incoming pokemon in that bench slot.

Usage: .cache/venv/bin/python mart_trade_party_slot.py [shot_prefix]
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"

TWO_SHOP_GRAPH_JS = """() => {
    const run = JSON.parse(localStorage.getItem('%s'));
    run.area.graph = {
        columns: [],
        edges: [
            { from: 'start', to: 'shop-1' },
            { from: 'shop-1', to: 'shop-2' }
        ],
        nodes: [
            { id: 'start', lane: 2, step: 0, type: 'start', x: 5, y: 30 },
            { id: 'shop-1', lane: 2, step: 1, type: 'shop', x: 50, y: 30 },
            { id: 'shop-2', lane: 2, step: 2, type: 'shop', x: 80, y: 30 }
        ]
    };
    run.area.currentNodeId = 'start';
    run.area.visitedNodeIds = ['start'];
    run.area.traveledPathKeys = [];
    run.area.activeMartNodeId = null;
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)

# A party over the active limit so bench pokemon exist to be wrongly promoted,
# plus one attack per owned pokemon's primary type so the deck has something to
# re-sort. Species are picked from live data by type, never by name. Every
# benched pokemon's types are covered by the party, because the mart rolls its
# wanted type over active+bench types and this run needs a party member to match.
SET_COLLECTIONS_JS = """(benchCount) => {
    const gameData = window.CardArena.GameData;
    const locations = window.PokeLocations;
    const limit = window.PokeRun.ACTIVE_POKEMON_LIMIT;
    const typesOf = record => [record.type1, record.type2, record.type3]
        .filter(type => type && type !== 'NONE');
    const obtainable = gameData.pokemon.filter(record =>
        !locations || typeof locations.isObtainablePokemon !== 'function' ||
        locations.isObtainablePokemon(record, gameData));
    const seenTypes = new Set();
    const active = [];

    obtainable.forEach(record => {
        if (active.length >= limit || seenTypes.has(record.type1)) return;

        seenTypes.add(record.type1);
        active.push(record);
    });

    const partyTypes = new Set();

    active.forEach(record => typesOf(record).forEach(type => partyTypes.add(type)));

    const bench = obtainable
        .filter(record => !active.includes(record) && typesOf(record).every(type => partyTypes.has(type)))
        .slice(0, benchCount);
    const picks = [...active, ...bench];
    const run = JSON.parse(localStorage.getItem('%s'));
    const toCard = (record, index) => ({
        currentHealth: record.baseHealth,
        currentStatus: [],
        faceUp: true,
        hasUsedFossilRevival: false,
        id: `test-pkmn-${record.name}-${index}`,
        kind: 'pokemon',
        owner: 'player',
        pokemon: record,
        statStages: { attack: 0, defense: 0, speed: 0 },
        vitamins: []
    });

    run.collections.pokemon = active.map(toCard);
    run.collections.bench.pokemon = bench.map(toCard);

    // One single-type attack per owned type, so trading changes which are playable.
    const attacks = [];

    picks.forEach((record, index) => {
        const attack = gameData.attacks.find(candidate =>
            candidate.type1 === record.type1 &&
            (!candidate.type2 || candidate.type2 === 'NONE'));

        if (attack) attacks.push({ attack, faceUp: true, id: `test-atk-${index}`, kind: 'attack', owner: 'player' });
    });

    run.collections.actions = attacks;
    run.collections.bench.actions = [];
    localStorage.setItem('%s', JSON.stringify(run));

    return {
        active: run.collections.pokemon.map(card => card.pokemon.name),
        bench: run.collections.bench.pokemon.map(card => card.pokemon.name)
    };
}""" % (RUN_KEY, RUN_KEY)


def get_run(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))


def get_trades(page, node_id):
    return get_run(page)["martEncounters"][node_id]["trades"]


def record_types(record):
    return [t for t in (record.get("type1"), record.get("type2"), record.get("type3")) if t and t != "NONE"]


def attack_types(attack):
    return [t for t in (attack.get("type1"), attack.get("type2")) if t and t != "NONE"]


def playable(attack, party):
    required = attack_types(attack)
    if not required:
        return True
    party_types = [record_types(card["pokemon"]) for card in party]
    if attack.get("full_type_requirements"):
        return any(all(t in types for t in required) for types in party_types)
    return any(any(t in types for t in required) for types in party_types)


def active_names(page):
    return [card["pokemon"]["name"] for card in get_run(page)["collections"]["pokemon"]]


def bench_names(page):
    return [card["pokemon"]["name"] for card in get_run(page)["collections"]["bench"]["pokemon"]]


def start_run(page, base):
    page.goto(f"{base}/starter.html")
    page.wait_for_selector(".starter-card[data-starter='water']")
    page.evaluate("localStorage.clear()")
    page.click(".starter-card[data-starter='water']")
    page.wait_for_function(
        "() => location.pathname.endsWith('area.html') && localStorage.getItem('%s')" % RUN_KEY,
        timeout=15000,
    )
    page.evaluate(TWO_SHOP_GRAPH_JS)
    return page.evaluate(SET_COLLECTIONS_JS, 3)


def enter_shop(page, node_id):
    page.reload()
    page.wait_for_selector(f"[data-node-id='{node_id}']")
    page.click(f"[data-node-id='{node_id}']")
    page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
    page.wait_for_selector(".mart-trade-row")


def find_offer(page, node_id, candidates):
    """First (offer index, owned name) pair whose types satisfy that offer."""
    for index, trade in enumerate(get_trades(page, node_id)):
        if trade["used"]:
            continue
        for card in candidates:
            if trade["acceptedType"] in record_types(card["pokemon"]):
                return index, card, trade["offeredName"]
    return None, None, None


def take_trade(page, node_id, index, name):
    page.click(f"[aria-label='Select {name}']")
    page.click(f"[data-mart-service='trade'][data-trade-index='{index}']")
    page.wait_for_selector("[data-mart-confirm-overlay]")
    page.click("[data-resolve-mart-confirm]")
    page.wait_for_function(
        "([node, i]) => JSON.parse(localStorage.getItem('%s')).martEncounters[node].trades[i].used === true"
        % RUN_KEY,
        arg=[node_id, index],
        timeout=5000,
    )


def main():
    shot_prefix = sys.argv[1] if len(sys.argv) > 1 else None
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        seeded = start_run(page, base)
        print(f"seeded active={seeded['active']} bench={seeded['bench']}")
        enter_shop(page, "shop-1")

        run_before = get_run(page)
        party_before = run_before["collections"]["pokemon"]
        bench_before = [card["pokemon"]["name"] for card in run_before["collections"]["bench"]["pokemon"]]
        index, card, offered_name = find_offer(page, "shop-1", party_before)

        if card is None:
            ok = False
            print(f"FAIL: no offer matched any party pokemon: {get_trades(page, 'shop-1')}")
        else:
            slot = [c["id"] for c in party_before].index(card["id"])
            print(f"(a) trading party slot {slot} ({card['pokemon']['name']}) for {offered_name}")
            take_trade(page, "shop-1", index, card["pokemon"]["name"])

            after = active_names(page)
            print(f"(a) active after={after}")
            print(f"(a) bench  after={bench_names(page)}")

            if len(after) != len(party_before):
                ok = False
                print(f"FAIL: party size should stay {len(party_before)}, got {len(after)}")
            if after[slot] != offered_name:
                ok = False
                print(f"FAIL: slot {slot} should hold {offered_name!r}, holds {after[slot]!r}")
            if bench_names(page) != bench_before:
                ok = False
                print(f"FAIL: bench should be untouched, was {bench_before} now {bench_names(page)}")

            # (b) The deck is re-sorted for the party the trade produced.
            run_after = get_run(page)
            party_after = run_after["collections"]["pokemon"]
            unplayable = [c["attack"]["name"] for c in run_after["collections"]["actions"]
                          if c.get("attack") and not playable(c["attack"], party_after)]
            stranded = [c["attack"]["name"] for c in run_after["collections"]["bench"]["actions"]
                        if c.get("attack") and playable(c["attack"], party_after)]
            print(f"(b) deck={[c['attack']['name'] for c in run_after['collections']['actions'] if c.get('attack')]}")
            print(f"(b) attack bench={[c['attack']['name'] for c in run_after['collections']['bench']['actions'] if c.get('attack')]}")
            if unplayable:
                ok = False
                print(f"FAIL: deck keeps attacks no active pokemon can use: {unplayable}")
            if stranded:
                ok = False
                print(f"FAIL: attack bench keeps attacks the new party can use: {stranded}")

            message = page.eval_on_selector(".mart-message", "el => el.textContent.trim()")
            print(f"(b) status line: {message!r}")

            if shot_prefix:
                page.screenshot(path=f"{shot_prefix}_party.png")

        # (c) A benched pokemon keeps its bench slot.
        page.click("[data-mart-action='continue']")
        page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=15000)
        enter_shop(page, "shop-2")

        bench_cards = get_run(page)["collections"]["bench"]["pokemon"]
        index, card, offered_name = find_offer(page, "shop-2", bench_cards)

        if card is None:
            print("(c) SKIP: no shop-2 offer matched a benched pokemon")
        else:
            slot = [c["id"] for c in bench_cards].index(card["id"])
            active_before = active_names(page)
            print(f"(c) trading bench slot {slot} ({card['pokemon']['name']}) for {offered_name}")
            take_trade(page, "shop-2", index, card["pokemon"]["name"])

            bench_after = bench_names(page)
            print(f"(c) bench after={bench_after}")
            if bench_after[slot] != offered_name:
                ok = False
                print(f"FAIL: bench slot {slot} should hold {offered_name!r}, holds {bench_after[slot]!r}")
            if active_names(page) != active_before:
                ok = False
                print(f"FAIL: active party should be untouched, was {active_before} now {active_names(page)}")

            if shot_prefix:
                page.screenshot(path=f"{shot_prefix}_bench.png")

        browser.close()

    if errors:
        ok = False
        print("\n".join(errors))

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
