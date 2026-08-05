"""Screenshots the battle-reference effect chips so the recolored artificial-effect
icons (Energize / Recycle / Refresh / Increase Capacity) and the Effect Boost side
marker can be checked for contrast."""

import lib

with lib.fresh_battle() as (page, errors):
    page.click("[data-action='toggle-rules']")
    page.wait_for_selector(".rules-reference-window")
    page.wait_for_timeout(400)
    rows = page.locator(".rules-reference-section").nth(1).locator(".reference-rule-row")
    rows.last.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    first = rows.nth(rows.count() - 4).bounding_box()
    last = rows.last.bounding_box()
    page.screenshot(path="icon_reference_window.png", clip={
        "x": first["x"] - 8,
        "y": first["y"] - 8,
        "width": max(first["width"], last["width"]) + 16,
        "height": last["y"] + last["height"] - first["y"] + 16
    })

    # Blow the chips up temporarily so the recolored glyphs can be inspected.
    page.add_style_tag(content=".reference-status-chip .action-status-token"
                               " { width: 56px !important; height: 56px !important; }")
    page.wait_for_timeout(200)
    rows.last.scroll_into_view_if_needed()
    first = rows.nth(rows.count() - 4).bounding_box()
    last = rows.last.bounding_box()
    page.screenshot(path="icon_reference_zoom.png", clip={
        "x": first["x"] - 8,
        "y": first["y"] - 8,
        "width": 260,
        "height": last["y"] + last["height"] - first["y"] + 16
    })

    # Force an Effect Boost marker on the player side to check the tray token.
    page.evaluate("CardArena.state.players.player.effectBoost = true;"
                  " CardArena.Render.render();")
    page.click("[data-action='close-rules']")
    page.wait_for_timeout(300)
    page.screenshot(path="icon_board.png")
    box = page.locator(".effect-boost-tray--player").bounding_box()
    page.screenshot(path="icon_effect_boost.png", clip={
        "x": box["x"] - 12,
        "y": box["y"] - 12,
        "width": box["width"] + 24,
        "height": box["height"] + 24
    })

    print("errors:", errors)
