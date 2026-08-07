"""Verification: map-level music that carries through standard/ace battles.

Seeds a temporary music.json (several 'trainer' map tracks + one per battle
category) with silent MP3 fixtures, starts a run, and asserts:

- area.html picks a map track, stores it on the run (musicTrackId) and in
  localStorage['pokemon-rogue-pocket-audio-track'];
- a standard/ace battle on game.html keeps that same track and resumes it
  where the map left it (position > 0), instead of restarting or swapping;
- a gym leader battle swaps to the 'boss' category and leaves the stored map
  position alone, and finishing that battle hands back to the map track;
- advancing a level clears the pick, so the next level gets a fresh song at
  position 0;
- the map's own mute button toggles PokeAudio.

`new Audio()` elements are never attached to the DOM, so an init script wraps
window.Audio to record every instance created (same trick as
phase100_battle_music.py); the last one is "the" music element.

Restores music.json and deletes the fixture MP3s in a finally block so a
failure never leaves the repo dirty.
"""
import json
import sys
from pathlib import Path

from lib import ROOT, serving, sync_playwright

MUSIC_JSON = ROOT / "music.json"
MUSIC_DIR = ROOT / "assets" / "music"
ORIGINAL_MUSIC_JSON = MUSIC_JSON.read_text()
SHOT = Path(__file__).parent / "level_music.png"

# One MPEG-1 Layer III frame (128kbps/44100Hz stereo, no CRC), payload zeroed
# out. Repeated so the fixture lasts ~10s: the position-resume assertion needs
# a track long enough that a second of playback is not a full loop.
_MP3_FRAME_HEADER = bytes([0xFF, 0xFB, 0x90, 0x44])
_MP3_FRAME_SIZE = 417  # floor(144 * 128000 / 44100), per the MPEG bitrate formula
SILENT_MP3 = (_MP3_FRAME_HEADER + bytes(_MP3_FRAME_SIZE - len(_MP3_FRAME_HEADER))) * 400

MAP_TRACK_IDS = [f"verify-map-{i}" for i in range(1, 7)]
TRACKS = [
    {"id": track_id, "title": track_id, "category": "trainer",
     "file": f"assets/music/{track_id}.mp3", "enabled": True}
    for track_id in MAP_TRACK_IDS
] + [
    {"id": "verify-boss", "title": "Verify Boss", "category": "boss",
     "file": "assets/music/verify-boss.mp3", "enabled": True},
    {"id": "verify-elite", "title": "Verify Elite", "category": "elite",
     "file": "assets/music/verify-elite.mp3", "enabled": True},
    {"id": "verify-legendary", "title": "Verify Legendary", "category": "legendary",
     "file": "assets/music/verify-legendary.mp3", "enabled": True},
]

AUDIO_INIT_SCRIPT = """
(() => {
    const NativeAudio = window.Audio;
    window.__audioInstances = [];
    function TrackedAudio(...args) {
        const instance = new NativeAudio(...args);
        window.__audioInstances.push(instance);
        return instance;
    }
    TrackedAudio.prototype = NativeAudio.prototype;
    window.Audio = TrackedAudio;
})();
"""

# What is playing right now, plus what the page persisted about it.
PROBE = """() => {
    const el = window.__audioInstances[window.__audioInstances.length - 1];
    const run = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run') || 'null');
    const stored = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-audio-track') || 'null');
    const track = window.PokeAudio.getCurrentTrack();
    return {
        currentTrackId: track ? track.id : null,
        currentCategory: track ? track.category : null,
        src: el ? el.src.split('/').pop() : null,
        currentTime: el ? el.currentTime : null,
        paused: el ? el.paused : null,
        runTrackId: run ? run.musicTrackId : null,
        runLevel: run ? run.level : null,
        storedTrackId: stored ? stored.trackId : null,
        storedPosition: stored ? stored.position : null
    };
}"""

# Points the run at one of its own battle nodes and swaps in a trainer of the
# wanted rank, so game.html can be opened straight into that kind of battle.
SET_BATTLE = """(rank) => {
    const run = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'));
    const nodeId = Object.keys(run.battleEncounters)[0];
    const trainer = window.CardArena.GameData.trainers.find(t => t.rank === rank);
    run.battleEncounters[nodeId].trainerName = trainer.name;
    run.battleEncounters[nodeId].outcome = null;
    run.battleEncounters[nodeId].completed = false;
    run.area.activeBattleNodeId = nodeId;
    localStorage.setItem('pokemon-rogue-pocket-run', JSON.stringify(run));
    return { nodeId, trainer: trainer.name, rank: trainer.rank };
}"""

created_files = []
ok = True
failures = []


def check(condition, message):
    global ok
    if not condition:
        ok = False
        failures.append(message)
        print("FAIL:", message)


try:
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    for track in TRACKS:
        path = ROOT / track["file"]
        path.write_bytes(SILENT_MP3)
        created_files.append(path)
    MUSIC_JSON.write_text(json.dumps(TRACKS, indent=2) + "\n")

    with serving() as base_url, sync_playwright() as p:
        # Pages are reached by navigation here, with no click in between, so the
        # no-gesture flag stands in for the real player's gesture.
        browser = p.chromium.launch(
            headless=True, args=["--autoplay-policy=no-user-gesture-required"]
        )
        page = browser.new_page()
        page.add_init_script(AUDIO_INIT_SCRIPT)

        errors = []
        # Missing art (a portrait or map background this repo does not ship) is
        # noise for this driver, so 404s are reported by URL rather than as a
        # bare console.error.
        missing = []
        page.on(
            "response",
            lambda r: missing.append(r.url) if r.status == 404 else None,
        )
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None,
        )

        # --- 1. the map picks and holds a level track -----------------------
        page.goto(f"{base_url}/starter.html")
        page.evaluate("localStorage.clear()")
        page.reload()
        page.wait_for_selector(".starter-card[data-starter='water']", timeout=15000)
        page.click(".starter-card[data-starter='water']")
        page.wait_for_selector(".area-topbar", timeout=15000)
        page.wait_for_timeout(1200)

        on_map = page.evaluate(PROBE)
        print("map:", on_map)
        check(on_map["currentTrackId"] in MAP_TRACK_IDS, "map did not start a 'trainer' map track")
        check(on_map["runTrackId"] == on_map["currentTrackId"], "run.musicTrackId does not match the playing track")
        check(on_map["storedTrackId"] == on_map["currentTrackId"], "stored level track does not match the playing track")
        check(on_map["currentTime"] > 0, "map music never advanced (nothing actually played)")
        page.screenshot(path=str(SHOT))

        level_track = on_map["currentTrackId"]

        # --- 2. a standard battle keeps the map track, resumed --------------
        print("standard battle:", page.evaluate(SET_BATTLE, "Standard"))
        page.goto(f"{base_url}/game.html")
        page.wait_for_selector(".battle-flow-card", timeout=15000)
        page.wait_for_timeout(800)

        in_battle = page.evaluate(PROBE)
        print("standard battle:", in_battle)
        check(in_battle["currentTrackId"] == level_track, "standard battle did not keep the level track")
        check(in_battle["currentTime"] > 0, "standard battle restarted the level track from 0")

        # --- 3. a gym leader battle gets its own song -----------------------
        # Rewritten from the battle page: area.html would bounce straight back
        # here anyway, since the run has an active battle node.
        print("boss battle:", page.evaluate(SET_BATTLE, "Boss"))
        page.goto(f"{base_url}/game.html")
        page.wait_for_selector(".battle-flow-card", timeout=15000)
        page.click("[data-battle-flow-action='start']")
        page.wait_for_selector("#game-board .playing-card", timeout=15000)
        page.wait_for_timeout(800)

        boss = page.evaluate(PROBE)
        print("boss battle:", boss)
        check(boss["currentCategory"] == "boss", "gym leader battle did not play the 'boss' category")
        check(boss["storedTrackId"] == level_track, "the boss song overwrote the stored level track")
        check(boss["runTrackId"] == level_track, "the boss song overwrote run.musicTrackId")

        # Ending the battle hands back to the level's music.
        page.evaluate("() => CardArena.BattleFlow.handleBattleFinished('loss')")
        page.wait_for_timeout(500)
        after_battle = page.evaluate(PROBE)
        print("after boss battle:", after_battle)
        check(after_battle["currentTrackId"] == level_track, "the level track did not come back after the battle")

        # --- 4. a new level means a new song --------------------------------
        page.evaluate(
            """() => {
                const run = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'));
                run.area.completed = true;
                run.area.activeBattleNodeId = null;
                localStorage.setItem('pokemon-rogue-pocket-run', JSON.stringify(run));
            }"""
        )
        page.goto(f"{base_url}/area.html")
        page.wait_for_selector(".area-topbar", timeout=15000)
        page.wait_for_timeout(500)

        next_level = page.evaluate(PROBE)
        print("next level:", next_level)
        check(next_level["runLevel"] == 2, "the level did not advance")
        check(next_level["currentTrackId"] in MAP_TRACK_IDS, "level 2 has no map track")
        check(next_level["runTrackId"] == next_level["currentTrackId"], "level 2 track was not stored on the run")
        check(next_level["storedPosition"] < 1, "level 2 resumed a position instead of starting fresh")

        # --- 5. the level track follows the player onto an encounter page ---
        # Non-battle encounters are created on arrival, so this walks the map
        # for real: the first selectable node lands on whichever run page it is.
        level_two_track = next_level["currentTrackId"]
        page.click(".area-map-canvas [data-node-id]:not([disabled])")
        page.wait_for_load_state()
        page.wait_for_timeout(800)

        encounter_page = page.url.split("/")[-1]
        on_encounter = page.evaluate(PROBE)
        print("encounter page:", encounter_page, on_encounter)
        check(encounter_page != "area.html", "clicking a node did not open an encounter page")
        check(on_encounter["currentTrackId"] == level_two_track,
              f"{encounter_page} did not keep the level track")

        # Leave the encounter, or area.html just redirects back into it.
        page.evaluate(
            """() => {
                const run = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'));
                ['activeAttackNodeId', 'activeBattleNodeId', 'activeCaptureNodeId',
                 'activeEventNodeId', 'activeMartNodeId'].forEach(key => { run.area[key] = null; });
                localStorage.setItem('pokemon-rogue-pocket-run', JSON.stringify(run));
            }"""
        )
        page.goto(f"{base_url}/area.html")
        page.wait_for_selector(".area-topbar", timeout=15000)

        # --- 6. the map can mute -------------------------------------------
        page.click("[data-toggle-mute]")
        page.wait_for_timeout(200)
        check(page.evaluate("() => window.PokeAudio.isMuted()") is True, "the map mute button did not mute")
        page.click("[data-toggle-mute]")
        page.wait_for_timeout(200)
        check(page.evaluate("() => window.PokeAudio.isMuted()") is False, "the map mute button did not unmute")

        if missing:
            print("404s (art only, not music):", sorted(set(missing)))
            check(
                not [url for url in missing if "/music/" in url],
                "a music file 404ed",
            )
        errors = [error for error in errors if "Failed to load resource" not in error]

        if errors:
            print("PAGE ERRORS:", errors)
            ok = False

        browser.close()
finally:
    MUSIC_JSON.write_text(ORIGINAL_MUSIC_JSON)
    for path in created_files:
        path.unlink(missing_ok=True)

print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
