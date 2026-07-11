"""Shared plumbing for driving PokeRoguePocket battles in headless Chromium.

Run scripts with the venv from setup.sh: .cache/venv/bin/python <script>.
LD_LIBRARY_PATH for the extracted system libs is set here automatically.
"""

import contextlib
import http.client
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIBS = HERE / ".cache" / "locallibs" / "usr" / "lib" / "x86_64-linux-gnu"
PORT = 8931
BASE_URL = f"http://127.0.0.1:{PORT}"

# Must happen before Playwright launches the browser subprocess.
if LIBS.is_dir():
    os.environ["LD_LIBRARY_PATH"] = f"{LIBS}:{os.environ.get('LD_LIBRARY_PATH', '')}"

from playwright.sync_api import sync_playwright  # noqa: E402

STATE_PROBE = """(() => {
    if (!window.CardArena || !CardArena.state || !CardArena.state.players) {
        return { phase: 'booting', isResolving: true, currentPlayer: null,
                 finished: false, turnNumber: 0, playerKnockouts: 0,
                 opponentKnockouts: 0, handSize: 0 };
    }
    const s = CardArena.state;
    return {
        phase: s.phase,
        isResolving: s.isResolving,
        currentPlayer: s.currentPlayer,
        finished: s.finished,
        turnNumber: s.turnNumber,
        playerKnockouts: s.players.player?.knockoutCount ?? 0,
        opponentKnockouts: s.players.opponent?.knockoutCount ?? 0,
        handSize: s.players.player?.hand.length ?? 0
    };
})()"""


def _server_running():
    try:
        conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=1)
        conn.request("HEAD", "/game.html")
        return conn.getresponse().status == 200
    except OSError:
        return False


@contextlib.contextmanager
def serving():
    """Serves the repo on PORT unless something already does."""
    proc = None
    if not _server_running():
        proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(50):
            if _server_running():
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("http.server did not come up on port %d" % PORT)
    try:
        yield BASE_URL
    finally:
        if proc:
            proc.terminate()


@contextlib.contextmanager
def fresh_battle():
    """Yields (page, errors) on a clean default battle at the player's turn.

    errors collects pageerror and console-error lines; a clean run stays empty
    apart from fallback warnings, which are not collected.
    """
    errors = []
    with serving() as base_url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
        page.on(
            "console",
            lambda msg: errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
        )
        page.goto(f"{base_url}/game.html")
        page.evaluate("localStorage.clear()")  # saved battles auto-restore otherwise
        page.reload()
        wait_for_player_turn(page)
        try:
            yield page, errors
        finally:
            browser.close()


def state(page):
    return page.evaluate(STATE_PROBE)


def wait_for_player_turn(page, timeout=90):
    """Polls until input unlocks or the battle finishes. Opponent turns plus
    resolution can take 20s+; never sleep blind."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        current = state(page)
        if current["finished"]:
            return current
        if (
            current["phase"] == "turn"
            and not current["isResolving"]
            and current["currentPlayer"] == "player"
        ):
            return current
        time.sleep(0.5)
    raise TimeoutError(f"player turn not reached: {state(page)}")


# Every click re-renders the battle DOM, so element handles go stale fast.
# Click by selector instead: page.click re-resolves at click time.
def _try_click(page, selector, timeout=2000):
    try:
        page.click(selector, timeout=timeout)
        return True
    except Exception:
        return False


def _hand_card_ids(page, kind):
    cards = page.query_selector_all(f".hand-row--player [data-card-id].card-kind-{kind}")
    return [card.get_attribute("data-card-id") for card in cards]


def _click_target(page):
    return _try_click(page, ".playing-card.is-targetable") or _try_click(
        page, ".played-slots.is-group-target"
    )


def _left_hand(page, card_id):
    """A card was successfully played iff it left the player's hand.
    SELF/SIDE-target actions complete on the user click with no target step,
    so a missing target click is not a failure signal."""
    return page.evaluate(
        "cardId => !CardArena.state.players.player.hand.some(card => card.id === cardId)",
        card_id,
    )


def play_attack(page, skip_card_ids=()):
    """Plays the first playable attack in hand (card -> user -> target).
    Returns the played card id, or None when nothing is playable."""
    for card_id in _hand_card_ids(page, "attack"):
        if card_id in skip_card_ids:
            continue
        if not _try_click(page, f'.hand-row--player [data-card-id="{card_id}"]'):
            continue
        page.wait_for_timeout(200)
        if _try_click(page, ".side-panel--player .playing-card.is-user-option"):
            page.wait_for_timeout(200)
            _click_target(page)
            page.wait_for_timeout(300)
        if _left_hand(page, card_id):
            return card_id
        _try_click(page, "[data-action='cancel-action']", timeout=500)
        page.wait_for_timeout(200)
    return None


def play_item(page):
    """Plays the first usable item in hand. Returns the card id or None."""
    for card_id in _hand_card_ids(page, "item"):
        if not _try_click(page, f'.hand-row--player [data-card-id="{card_id}"]'):
            continue
        page.wait_for_timeout(200)
        _click_target(page)
        page.wait_for_timeout(300)
        if _left_hand(page, card_id):
            return card_id
        _try_click(page, "[data-action='cancel-action']", timeout=500)
        page.wait_for_timeout(200)
    return None


def discard_a_card(page):
    """Selects the first hand card and discards it. Returns True on success."""
    card_ids = [card.get_attribute("data-card-id") for card in
                page.query_selector_all(".hand-row--player [data-card-id]")]
    if not card_ids:
        return False
    if not _try_click(page, f'.hand-row--player [data-card-id="{card_ids[0]}"]'):
        return False
    page.wait_for_timeout(200)
    # page.click waits for the button to become enabled or times out.
    if not _try_click(page, "[data-action='discard-selected']"):
        return False
    page.wait_for_timeout(300)
    return True


def end_turn(page, timeout=15):
    """Clicks End Turn once the controller allows it. Returns True on click."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _try_click(page, "[data-action='end-turn']", timeout=1000):
            return True
        time.sleep(0.3)
    return False
