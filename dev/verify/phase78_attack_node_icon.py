"""Phase 78 verification: the `attack` node type renders (icon, legend, aria label).

Nothing generates an 'attack' node yet (that's phase 79), so this driver boots
a fresh run to area.html, then reaches into the saved run in localStorage and
rewrites one existing 'battle' node to type 'attack' before reloading. Checks:
the crimson A pill renders on the map, the legend grows a sixth "Attack
Encounter" entry, and the node's aria-label reads "Attack Encounter, ...".

Usage: .cache/venv/bin/python phase78_attack_node_icon.py [shot.png]
"""

import sys

from lib import serving, sync_playwright

RUN_STATE_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"

INJECT_ATTACK_NODE = """() => {
    const run = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'));
    const target = run.area.graph.nodes.find(node => node.type === 'battle');
    target.type = 'attack';
    run.area.graph.columns.forEach(col => col.forEach(n => { if (n.id === target.id) n.type = 'attack'; }));
    localStorage.setItem('pokemon-rogue-pocket-run', JSON.stringify(run));
    return target.id;
}"""


def main():
    shot_path = sys.argv[1] if len(sys.argv) > 1 else "phase78_attack_node_icon.png"
    ok = True
    errors = []
    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='fire']")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
            timeout=15000,
        )
        page.wait_for_selector(".area-node", timeout=15000)

        target_id = page.evaluate(INJECT_ATTACK_NODE)
        print(f"rewrote node {target_id} to type 'attack'")
        page.reload()
        page.wait_for_selector(".area-node", timeout=15000)

        node_selector = f".area-node[data-node-id='{target_id}']"
        node = page.query_selector(node_selector)
        if node is None:
            ok = False
            print(f"  FAIL no .area-node found for id {target_id}")
        else:
            icon = node.query_selector(".area-icon--attack")
            if icon is None:
                ok = False
                print("  FAIL no .area-icon--attack span inside the rewritten node")
            else:
                text = icon.inner_text().strip()
                bg = icon.evaluate("el => getComputedStyle(el).backgroundImage")
                print(f"icon text={text!r} background-image={bg}")
                if text != "A":
                    ok = False
                    print(f"  FAIL icon glyph is {text!r}, want 'A'")
                elif "184, 64, 42" not in bg and "#b8402a" not in bg.lower():
                    ok = False
                    print("  FAIL icon background does not contain the crimson stop (#b8402a)")
                else:
                    print("  OK   crimson A pill renders")

            aria = node.get_attribute("aria-label") or ""
            print(f"aria-label={aria!r}")
            if not aria.startswith("Attack Encounter"):
                ok = False
                print("  FAIL aria-label does not start with 'Attack Encounter'")
            else:
                print("  OK   aria-label announces Attack Encounter")

        legend_items = page.query_selector_all(".area-legend-item")
        legend_texts = [el.inner_text().strip() for el in legend_items]
        print(f"legend entries ({len(legend_texts)})={legend_texts}")
        if len(legend_texts) != 6:
            ok = False
            print(f"  FAIL legend has {len(legend_texts)} entries, want 6")
        if not any("Attack Encounter" in t for t in legend_texts):
            ok = False
            print("  FAIL legend has no 'Attack Encounter' entry")
        else:
            print("  OK   legend shows Attack Encounter")

        page.screenshot(path=shot_path, full_page=True)
        print(f"screenshot saved to {shot_path}")

        if errors:
            ok = False
            print("Page/console errors:")
            for e in errors:
                print(f"  {e}")

        page.evaluate("localStorage.clear()")
        browser.close()

    print("RESULT:", "OK" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
