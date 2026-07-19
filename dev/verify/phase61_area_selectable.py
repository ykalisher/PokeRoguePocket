"""Phase 61 step 4 verification: area.js selectable-node-set precompute.

Loads a fresh run on area.html, checks that exactly the nodes reachable from
the current node carry is-selectable / are clickable, that unreachable and
visited nodes do not, and that clicking a selectable node still advances
state.currentNodeId (via PokeRun.loadRunState()).

Usage: .cache/venv/bin/python phase61_area_selectable.py
"""

import sys

from lib import serving, sync_playwright

RUN_STATE_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"


def main():
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

        run = page.evaluate(RUN_STATE_PROBE)
        current_id = run["area"]["currentNodeId"]
        visited_ids = set(run["area"]["visitedNodeIds"])
        edges = run["area"]["graph"]["edges"]
        expected_selectable = {
            e["to"] for e in edges
            if e["from"] == current_id and e["to"] not in visited_ids
        }
        print(f"currentNodeId={current_id} expected selectable={sorted(expected_selectable)}")

        nodes = page.query_selector_all(".area-node")
        actual_selectable = set()
        actual_disabled = set()
        for n in nodes:
            node_id = n.get_attribute("data-node-id") or n.get_attribute("data-node") or n.get_attribute("id")
            classes = (n.get_attribute("class") or "").split()
            is_selectable_class = "is-selectable" in classes
            is_disabled = n.get_attribute("disabled") is not None
            if is_selectable_class:
                actual_selectable.add(node_id)
            if is_disabled:
                actual_disabled.add(node_id)

        print(f"actual selectable (class)={sorted(actual_selectable)}")
        print(f"actual disabled={sorted(actual_disabled)}")

        if actual_selectable != expected_selectable:
            ok = False
            print(f"  FAIL selectable class mismatch: got {actual_selectable}, want {expected_selectable}")
        else:
            print("  OK   selectable class matches getAvailableNextNodes()")

        non_selectable_have_disabled = all(
            (n.get_attribute("data-node-id") in actual_selectable) or (n.get_attribute("disabled") is not None)
            for n in nodes
        )
        if not non_selectable_have_disabled:
            ok = False
            print("  FAIL some non-selectable node is missing disabled attr")
        else:
            print("  OK   non-selectable nodes are disabled")

        if expected_selectable:
            target_id = sorted(expected_selectable)[0]
            selector = f".area-node[data-node-id='{target_id}']"
            if page.query_selector(selector) is None:
                selector = f"[data-node-id='{target_id}']"
            page.click(selector)
            page.wait_for_timeout(500)
            new_run = page.evaluate(RUN_STATE_PROBE)
            new_current = new_run["area"]["currentNodeId"]
            print(f"clicked {target_id} -> new currentNodeId={new_current}")
            if new_current != target_id:
                ok = False
                print("  FAIL click on selectable node did not advance currentNodeId")
            else:
                print("  OK   click on selectable node advanced currentNodeId")
        else:
            print("  SKIP no selectable nodes to click (unexpected for a fresh run)")

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
