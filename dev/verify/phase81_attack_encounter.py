"""Phase 81 verification: the attack encounter page (attack.html).

Starts a fresh run, relabels the next reachable node as 'attack' in place
(same technique phase 78/80's drivers use - organically walking the generated
map to a real attack node isn't reliable since every other node type
immediately navigates away from area.html), then walks the full flow:

  1. Clicking the relabeled node opens attack.html with the location theme
     applied and 1-3 attack options, each neither LEGENDARY nor ARTIFICIAL.
  2. Picking an option plays the claim animation (title cycles through
     "Added <name> x2") and returns to area.html.
  3. The action deck (active + benched) gains exactly 2 copies of the claimed
     attack.
  4. The node renders visited/disabled and can't be replayed.
  5. Reloading attack.html directly with no active encounter bounces to
     area.html.
  6. A second relabeled node: reloading attack.html mid-encounter (before
     choosing) preserves the same persisted options instead of re-rolling.
  7. With that second encounter still unclaimed, index.html's Continue button
     routes to attack.html.

Usage: .cache/venv/bin/python phase81_attack_encounter.py
"""

import sys

from lib import serving, sync_playwright

RUN_STATE_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"

RELABEL_NEXT_NODE_AS_ATTACK = """
() => {
    const run = window.PokeRun.loadRunState();
    const currentId = run.area.currentNodeId;
    const edge = run.area.graph.edges.find(e => e.from === currentId);
    if (!edge) return null;
    const node = run.area.graph.nodes.find(n => n.id === edge.to);
    node.type = 'attack';
    window.PokeRun.saveRunState(run);
    return node.id;
}
"""


def main():
    ok = True
    errors = []
    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text}")
            if m.type == "error" and "Failed to load resource" not in m.text
            else None,
        )
        # Pre-existing, unrelated: some fire-location background PNGs are
        # missing from assets/backgrounds/ - not a regression from this
        # phase, so 404s on that path alone don't fail this check.
        page.on(
            "response",
            lambda r: errors.append(f"HTTP {r.status}: {r.url}")
            if r.status >= 400 and "assets/backgrounds/" not in r.url
            else None,
        )

        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='fire']")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
            timeout=15000,
        )
        page.wait_for_selector(".area-node", timeout=15000)

        run = page.evaluate(RUN_STATE_PROBE)
        location_types = run["location"]["types"]
        print(f"location types: {location_types}")

        attack_node_id = page.evaluate(RELABEL_NEXT_NODE_AS_ATTACK)
        if not attack_node_id:
            ok = False
            print("FAIL could not find a node reachable from the current node to relabel")
        else:
            print(f"relabeled {attack_node_id} as an 'attack' node; reloading area.html")
            page.reload()
            page.wait_for_selector(".area-node", timeout=15000)

            selector = f".area-node[data-node-id='{attack_node_id}']"
            page.click(selector)
            page.wait_for_function("() => location.pathname.endsWith('attack.html')", timeout=15000)
            page.wait_for_selector(".attack-option", timeout=15000)

            run = page.evaluate(RUN_STATE_PROBE)
            encounter = run["attackEncounters"][attack_node_id]
            options = encounter["options"]
            print(f"attack options offered: {options}")

            if not (1 <= len(options) <= 3):
                ok = False
                print(f"  FAIL expected 1-3 options, got {len(options)}")
            else:
                print("  OK   1-3 options offered")

            attacks_by_name = {a["name"]: a for a in page.evaluate("() => window.CardArena.GameData.attacks")}
            bad_options = []
            for name in options:
                record = attacks_by_name.get(name)
                if not record:
                    bad_options.append(f"{name} (not found in GameData.attacks)")
                    continue
                types = [t for t in (record.get("type1"), record.get("type2")) if t and t != "NONE"]
                if "LEGENDARY" in types or "ARTIFICIAL" in types:
                    bad_options.append(f"{name} (types={types})")
            if bad_options:
                ok = False
                print(f"  FAIL option(s) legendary/artificial or unresolved: {bad_options}")
            else:
                print("  OK   no option is LEGENDARY or ARTIFICIAL")

            option_cards = page.query_selector_all(".attack-option")
            print(f"rendered option cards: {len(option_cards)}")
            if len(option_cards) != len(options):
                ok = False
                print("  FAIL rendered option card count does not match stored options")

            body_location = page.evaluate("() => document.body.dataset.location")
            print(f"body data-location: {body_location!r}")
            if not body_location:
                ok = False
                print("  FAIL location theme was not applied (body.dataset.location empty)")
            else:
                print("  OK   location theme applied")

            page.screenshot(path="phase81_attack_encounter_offer.png")
            print("  saved phase81_attack_encounter_offer.png")

            claimed_name = options[0]
            page.click(".attack-option[data-attack-option='0']")
            page.wait_for_timeout(150)

            title_text = page.evaluate("() => document.querySelector('.attack-title-group h1')?.textContent")
            expected_title = f"Added {claimed_name} x2"
            print(f"title mid-animation: {title_text!r}")
            if title_text != expected_title:
                ok = False
                print(f"  FAIL expected title {expected_title!r}, got {title_text!r}")
            else:
                print("  OK   phase title reads 'Added <name> x2'")

            page.screenshot(path="phase81_attack_encounter_claimed.png")
            print("  saved phase81_attack_encounter_claimed.png")

            page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=15000)
            print("  OK   redirected back to area.html after the claim animation")

            run_after = page.evaluate(RUN_STATE_PROBE)
            active_actions = run_after["collections"]["actions"]
            bench_actions = run_after["collections"]["bench"]["actions"]
            matching = [
                c for c in active_actions + bench_actions
                if c.get("kind") == "attack" and c.get("attack", {}).get("name") == claimed_name
            ]
            print(f"reward copies of {claimed_name!r} found in actions+bench: {len(matching)}")
            if len(matching) != 2:
                ok = False
                print(f"  FAIL expected exactly 2 copies of {claimed_name}, found {len(matching)}")
            else:
                print("  OK   exactly 2 reward copies were added")

            node_selector = f".area-node[data-node-id='{attack_node_id}']"
            page.wait_for_selector(node_selector, timeout=15000)
            node_classes = page.get_attribute(node_selector, "class") or ""
            node_disabled = page.eval_on_selector(node_selector, "el => el.disabled")
            print(f"node classes: {node_classes!r} disabled={node_disabled}")
            if "is-visited" not in node_classes or not node_disabled:
                ok = False
                print("  FAIL completed attack node is not visited/disabled (replayable)")
            else:
                print("  OK   completed attack node is visited and disabled")

            page.goto(f"{base}/attack.html")
            page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=15000)
            print("  OK   direct reload of attack.html with no active encounter bounced to area.html")

        mid_node_id = page.evaluate(RELABEL_NEXT_NODE_AS_ATTACK)
        if not mid_node_id:
            print("SKIP no further reachable node to relabel for the mid-encounter reload / Continue checks")
        else:
            print(f"relabeled {mid_node_id} as a second 'attack' node; reloading area.html")
            page.reload()
            page.wait_for_selector(".area-node", timeout=15000)

            selector = f".area-node[data-node-id='{mid_node_id}']"
            page.click(selector)
            page.wait_for_function("() => location.pathname.endsWith('attack.html')", timeout=15000)
            page.wait_for_selector(".attack-option", timeout=15000)

            options_before = page.evaluate(RUN_STATE_PROBE)["attackEncounters"][mid_node_id]["options"]
            page.reload()
            page.wait_for_selector(".attack-option", timeout=15000)
            options_after = page.evaluate(RUN_STATE_PROBE)["attackEncounters"][mid_node_id]["options"]

            print(f"options before mid-encounter reload: {options_before}")
            print(f"options after mid-encounter reload:  {options_after}")
            if options_before != options_after:
                ok = False
                print("  FAIL mid-encounter reload re-rolled the stored options")
            else:
                print("  OK   mid-encounter reload preserved the persisted options")

            page.goto(f"{base}/index.html")
            page.wait_for_selector("#btn-load-game", timeout=15000)
            load_disabled = page.eval_on_selector("#btn-load-game", "el => el.disabled")
            print(f"Continue button disabled: {load_disabled}")
            if load_disabled:
                ok = False
                print("  FAIL Continue button is disabled despite a saved in-progress run")
            else:
                page.click("#btn-load-game")
                page.wait_for_function("() => location.pathname.endsWith('attack.html')", timeout=15000)
                print("  OK   Continue routed to attack.html for the unclaimed attack encounter")

        if errors:
            ok = False
            print("Page/console errors:")
            for e in errors:
                print(f"  {e}")

        browser.close()

    print("RESULT:", "OK" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
