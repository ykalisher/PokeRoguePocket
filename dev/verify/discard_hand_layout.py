"""Action-bar layout with the Discard Hand button added, across viewports.

Six commands no longer fit one row in the turn-control column, so this checks
the bar wraps instead of letting the buttons overlap: every button must stay
inside the action bar's box and no two may overlap.

Run: .cache/venv/bin/python discard_hand_layout.py
"""

from lib import fresh_battle, wait_for_player_turn

VIEWPORTS = [
    ("desktop_1440", 1440, 900),
    ("laptop_1280", 1280, 720),
    ("tablet_1024", 1024, 768),
    ("phone_390", 390, 844),
]

BUTTON_BOXES = """(() => {
    const bar = document.querySelector('.action-bar');

    if (!bar) return null;

    const box = element => {
        const rect = element.getBoundingClientRect();
        return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
    };

    return {
        bar: box(bar),
        buttons: [...bar.querySelectorAll('.arena-button')].map(button => ({
            ...box(button),
            label: button.textContent.trim().replace(/\\s+/g, ' ')
        }))
    };
})()"""


def overlaps(a, b):
    return (
        a["left"] < b["right"] - 0.5
        and b["left"] < a["right"] - 0.5
        and a["top"] < b["bottom"] - 0.5
        and b["top"] < a["bottom"] - 0.5
    )


def check(label, condition, detail=""):
    print(f"{'ok  ' if condition else 'FAIL'} {label}{f' — {detail}' if detail else ''}")
    if not condition:
        raise SystemExit(1)


with fresh_battle() as (page, errors):
    for name, width, height in VIEWPORTS:
        page.set_viewport_size({"width": width, "height": height})
        wait_for_player_turn(page)
        page.wait_for_timeout(200)

        layout = page.evaluate(BUTTON_BOXES)

        check(f"{name}: action bar rendered", layout is not None)

        labels = [button["label"] for button in layout["buttons"]]

        check(f"{name}: Discard Hand is in the bar", "Discard Hand" in labels, labels)

        for index, button in enumerate(layout["buttons"]):
            for other in layout["buttons"][index + 1:]:
                check(
                    f"{name}: '{button['label']}' and '{other['label']}' do not overlap",
                    not overlaps(button, other),
                    f"{button} vs {other}",
                )

            check(
                f"{name}: '{button['label']}' stays inside the action bar",
                button["right"] <= layout["bar"]["right"] + 0.5
                and button["left"] >= layout["bar"]["left"] - 0.5,
                f"{button} vs bar {layout['bar']}",
            )

        page.screenshot(path=f"discard_hand_layout_{name}.png")

    check("no page or console errors", not errors, "; ".join(errors))

print("\naction-bar layout verification passed")
