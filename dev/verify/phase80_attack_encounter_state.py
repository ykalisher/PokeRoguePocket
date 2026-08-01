"""Phase 80 verification: attack encounters exist in run state, but the node
is still inert (no attack.html/moveToNode branch until phase 81).

Starts a fresh run, then relabels the next reachable node as 'attack' in
place (every other node type immediately navigates away from area.html on
click - capture/battle/shop/event all leave the page - so walking the
generated map organically can't reach a later 'attack' node without first
completing an earlier encounter; relabeling isolates the one thing this
phase changes: what happens when an 'attack' node is clicked). Then confirms:
  1. The popup reads "You entered an Attack Encounter." and the page does NOT
     navigate away from area.html.
  2. localStorage's attackEncounters stays {} - moveToNode has no 'attack'
     branch yet, so no encounter should ever be created this phase.

Usage: .cache/venv/bin/python phase80_attack_encounter_state.py
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
        # "Failed to load resource" console errors are tracked separately via
        # the response listener below (so the known-unrelated background-PNG
        # 404s can be excluded); anything else logged as console.error here
        # is a real signal.
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text}")
            if m.type == "error" and "Failed to load resource" not in m.text
            else None,
        )
        # Pre-existing, unrelated: some fire-location background PNGs are
        # missing from assets/backgrounds/ (mt-chimney, cinder-ridge,
        # fuego-ironworks) - not a regression from this phase, so 404s on
        # that path alone don't fail this check.
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
        print(f"attackEncounters at run start: {run['attackEncounters']}")
        if run["attackEncounters"] != {}:
            ok = False
            print("  FAIL attackEncounters is not empty at run start")

        attack_node_id = page.evaluate(RELABEL_NEXT_NODE_AS_ATTACK)
        if not attack_node_id:
            ok = False
            print("  FAIL could not find a node reachable from the current node to relabel")
        else:
            print(f"relabeled {attack_node_id} as an 'attack' node; reloading area.html")
            page.reload()
            page.wait_for_selector(".area-node", timeout=15000)

            selector = f".area-node[data-node-id='{attack_node_id}']"
            page.wait_for_selector(selector, timeout=15000)
            page.click(selector)
            page.wait_for_timeout(500)

            popup_text = page.evaluate(
                "() => { const p = document.getElementById('area-popup'); "
                "return p && !p.hidden ? p.textContent.trim() : null; }"
            )
            print(f"popup text: {popup_text!r}")
            if not popup_text or "Attack Encounter" not in popup_text:
                ok = False
                print("  FAIL popup does not mention 'Attack Encounter'")
            else:
                print("  OK   popup announces the attack encounter")

            path = page.evaluate("() => location.pathname")
            print(f"pathname after click: {path}")
            if not path.endswith("area.html"):
                ok = False
                print("  FAIL navigated away from area.html (should be inert this phase)")
            else:
                print("  OK   stayed on area.html (no page to navigate to yet)")

            run_after = page.evaluate(RUN_STATE_PROBE)
            print(f"attackEncounters after click: {run_after['attackEncounters']}")
            if run_after["attackEncounters"] != {}:
                ok = False
                print("  FAIL an attack encounter was created (moveToNode should have no 'attack' branch yet)")
            else:
                print("  OK   attackEncounters is still {} - the node is inert")

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
