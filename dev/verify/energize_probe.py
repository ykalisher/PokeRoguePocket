"""Probe: Energize in the real battle UI.

1. Injects an ARTIFICIAL Pokemon plus two Energize cards into the player's
   hand, then plays both in the same turn (they should both be playable).
2. Readies three attacks with the energized ally and ends the turn, so the
   battle log shows the order the energized Pokemon's attacks resolved in
   (first readied should resolve first).
"""

import json
import sys

from lib import end_turn, fresh_battle, state, wait_for_player_turn

SETUP = """(() => {
    const s = CardArena.state;
    const player = s.players.player;
    const artificial = CardArena.GameData.pokemon.find(p => (p.types || []).includes('ARTIFICIAL'));
    const energize = CardArena.GameData.attacks.find(
        a => (a.types || []).includes('ARTIFICIAL') && a.status === 'EXTRA_ATTACK'
    );

    if (!artificial || !energize) return { ok: false, reason: 'no artificial data' };

    player.board[0] = {
        currentHealth: artificial.baseHealth,
        currentStatus: [],
        faceUp: true,
        hasUsedFossilRevival: false,
        id: 'PROBE-PKM-1',
        kind: 'pokemon',
        owner: 'player',
        pokemon: artificial,
        statStages: undefined,
        vitamins: []
    };

    const ally = player.board[1];
    const allyType = ally.pokemon.types[0];
    const probeAttack = (name, basePower) => ({
        attack: {
            basePower,
            full_type_requirements: false,
            name,
            status: 'NONE',
            statChanges: [],
            target: 'OPPONENT',
            type1: allyType,
            type2: 'NONE',
            types: [allyType]
        },
        faceUp: true,
        id: 'PROBE-' + name,
        kind: 'attack',
        owner: 'player'
    });

    player.hand = [
        { attack: energize, faceUp: true, id: 'PROBE-E1', kind: 'attack', owner: 'player' },
        { attack: energize, faceUp: true, id: 'PROBE-E2', kind: 'attack', owner: 'player' },
        probeAttack('FIRST', 10),
        probeAttack('SECOND', 60),
        probeAttack('THIRD', 140)
    ];

    CardArena.Render.render();

    return {
        ok: true,
        artificial: artificial.name,
        ally: ally.pokemon.name,
        allyId: ally.id
    };
})()"""

EXTRAS = "(() => JSON.stringify(CardArena.state.extraAttacks.player))()"


def left_hand(page, card_id):
    return page.evaluate(
        "cardId => !CardArena.state.players.player.hand.some(c => c.id === cardId)", card_id
    )


def play_energize(page, card_id):
    page.click(f'.hand-row--player [data-card-id="{card_id}"]')
    page.wait_for_timeout(300)
    page.click(".side-panel--player .playing-card.is-user-option")
    page.wait_for_timeout(1500)
    print(f"  {card_id}: played={left_hand(page, card_id)} extras={page.evaluate(EXTRAS)}")
    return left_hand(page, card_id)


def ready_attack(page, card_id, ally_id):
    page.click(f'.hand-row--player [data-card-id="{card_id}"]')
    page.wait_for_timeout(250)
    page.click(f'.side-panel--player .playing-card.is-user-option[data-board-card-id="{ally_id}"]')
    page.wait_for_timeout(250)
    page.click(".playing-card.is-targetable")
    page.wait_for_timeout(400)
    print(f"  readied {card_id}: {left_hand(page, card_id)}")
    return left_hand(page, card_id)


def main():
    with fresh_battle() as (page, errors):
        setup = page.evaluate(SETUP)
        print("setup:", json.dumps(setup))
        if not setup["ok"]:
            return 1

        played = [play_energize(page, "PROBE-E1"), play_energize(page, "PROBE-E2")]
        readied = [ready_attack(page, f"PROBE-{name}", setup["allyId"])
                   for name in ("FIRST", "SECOND", "THIRD")]

        page.screenshot(path="energize_probe.png")
        own = page.evaluate(
            "(() => CardArena.state.players.player.board.filter(Boolean).map(c => c.pokemon.name))()"
        )
        print("end turn:", end_turn(page))
        wait_for_player_turn(page)

        log = page.evaluate("(() => CardArena.state.log.slice().reverse())()")
        # Attack use is a popup, not a log line: the three probe attacks carry
        # very different base powers, so the damage lines reveal their order.
        damage = [line for line in log if "took" in line and "damage" in line
                  and not any(name in line for name in own)]
        print("damage lines:", json.dumps(damage, indent=1))
        print("state:", state(page))

        if errors:
            print("ERRORS:", errors)

        amounts = [int(line.split("took ")[1].split(" ")[0]) for line in damage]
        ok = all(played) and all(readied) and amounts == sorted(amounts)
        print("RESULT", "ok" if ok else "unexpected")
        return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
