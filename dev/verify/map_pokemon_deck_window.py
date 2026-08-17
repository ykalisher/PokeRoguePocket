"""Verify the map's Pokemon deck button opens the bench/swap window.

Starts a fresh run, moves one active Pokemon onto the bench via the saved run
state, reloads area.html, then clicks the Pokemon deck button in the HUD and
checks the resulting dialog is the same swap manager the Bench button shows —
same title, same card order, working active/bench selection and Swap.

Usage: .cache/venv/bin/python map_pokemon_deck_view.py [shot.png]
"""

import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"


def dialog_snapshot(page):
    return page.evaluate(
        """() => {
            const win = document.querySelector('.area-bench-window');
            if (!win) return null;
            const names = zone => Array.from(
                win.querySelectorAll(`[data-${zone}-pokemon-id]`)
            ).map(b => (b.getAttribute('aria-label') || '').replace('Select ', ''));
            return {
                title: win.querySelector('.area-card-window-title').textContent.trim(),
                count: win.querySelector('.area-card-window-count').textContent.trim(),
                active: names('active'),
                bench: names('bench'),
                hasSwap: !!win.querySelector('[data-bench-swap]')
            };
        }"""
    )


def main():
    shot = sys.argv[1] if len(sys.argv) > 1 else None
    ok = True
    errors = []

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)
        page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='fire']")
        page.wait_for_function(
            f"() => location.pathname.endsWith('area.html') && localStorage.getItem('{RUN_KEY}')",
            timeout=15000,
        )
        page.wait_for_selector(".area-node", timeout=15000)

        # Put one starter Pokemon on the bench so there is something to swap.
        page.evaluate(
            f"""() => {{
                const run = JSON.parse(localStorage.getItem('{RUN_KEY}'));
                const active = run.collections.pokemon;
                // Benched Pokemon are pulled back into an under-full active
                // deck on load, so fill it past the limit first.
                let n = 0;
                while (active.length <= 6) {{
                    const clone = JSON.parse(JSON.stringify(active[0]));
                    clone.id = `probe-clone-${{n++}}`;
                    active.push(clone);
                }}
                run.collections.bench.pokemon.push(active.pop());
                localStorage.setItem('{RUN_KEY}', JSON.stringify(run));
            }}"""
        )
        page.reload()
        page.wait_for_selector(".area-deck-button", timeout=15000)

        # Baseline: the Bench button's window.
        page.click("[data-bench-window].area-bench-button")
        page.wait_for_selector(".area-bench-window", timeout=5000)
        from_bench = dialog_snapshot(page)
        page.click("[data-close-bench-window]")

        # The Pokemon deck button (second deck button in the HUD).
        print("deck buttons in HUD:", len(page.query_selector_all(".area-hud .area-deck-button")))
        page.click(".area-hud .area-deck-button[data-bench-window]")
        page.wait_for_selector(".area-bench-window", timeout=5000)
        from_deck = dialog_snapshot(page)

        print(f"from Bench button: {from_bench}")
        print(f"from deck button : {from_deck}")

        if from_deck != from_bench:
            ok = False
            print("  FAIL the two entry points render different views")
        else:
            print("  OK   Pokemon deck button opens the identical bench window")

        if not from_deck or not from_deck["hasSwap"] or not from_deck["bench"]:
            ok = False
            print("  FAIL swap controls or bench section missing")
        else:
            print("  OK   swap control and bench section present")

        if shot:
            page.screenshot(path=shot)

        # Swap through the window opened from the deck button.
        ids = lambda run: (
            [c["id"] for c in run["collections"]["pokemon"]],
            [c["id"] for c in run["collections"]["bench"]["pokemon"]],
        )
        active_before, bench_before = ids(page.evaluate(f"() => JSON.parse(localStorage.getItem('{RUN_KEY}'))"))
        picked_active = page.get_attribute(".area-bench-window [data-active-pokemon-id]", "data-active-pokemon-id")
        picked_bench = page.get_attribute(".area-bench-window [data-bench-pokemon-id]", "data-bench-pokemon-id")
        page.click(f".area-bench-window [data-active-pokemon-id='{picked_active}']")
        page.click(f".area-bench-window [data-bench-pokemon-id='{picked_bench}']")
        swap = page.query_selector(".area-bench-window [data-bench-swap]")
        if swap.get_attribute("disabled") is not None:
            ok = False
            print("  FAIL Swap stayed disabled after selecting one from each side")
        else:
            print("  OK   Swap enabled after selecting one from each side")
            swap.click()
            page.wait_for_selector(".area-bench-summary", timeout=5000)
            active_after, bench_after = ids(page.evaluate(f"() => JSON.parse(localStorage.getItem('{RUN_KEY}'))"))
            print(f"active {active_before} -> {active_after}")
            print(f"bench  {bench_before} -> {bench_after}")
            if picked_bench not in active_after or picked_active not in bench_after:
                ok = False
                print("  FAIL the swap did not move the Pokemon in the saved run")
            else:
                print("  OK   swap persisted to the run state")

        if errors:
            ok = False
            print("page errors:")
            for e in errors:
                print(f"  {e}")

        browser.close()

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
