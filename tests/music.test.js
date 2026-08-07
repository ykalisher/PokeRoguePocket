'use strict';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { storageMap } = require('./helpers/arena_env');

const AUDIO_PATH = require.resolve('../arena/audio.js');

const TRACKS = [
    { id: 'trainer-a', category: 'trainer', enabled: true, file: 'assets/music/trainer-a.mp3' },
    { id: 'trainer-b', category: 'trainer', enabled: true, file: 'assets/music/trainer-b.mp3' },
    { id: 'trainer-c', category: 'trainer', enabled: false, file: 'assets/music/trainer-c.mp3' },
    { id: 'boss-a', category: 'boss', enabled: true, file: 'assets/music/boss-a.mp3' }
];

// audio.js keeps a module-level settings cache, so each test gets a fresh
// module instance (and a cleared storage backing) rather than sharing state.
let PokeAudio;

beforeEach(() => {
    storageMap.clear();
    delete require.cache[AUDIO_PATH];
    require(AUDIO_PATH);
    PokeAudio = window.PokeAudio;
});

test('pickTrack returns only enabled tracks of the requested category', () => {
    for (let i = 0; i < 20; i += 1) {
        const picked = PokeAudio.pickTrack(TRACKS, 'trainer', () => Math.random());

        assert.ok(picked);
        assert.equal(picked.category, 'trainer');
        assert.notEqual(picked.id, 'trainer-c');
    }
});

test('pickTrack returns null for an empty or all-disabled category', () => {
    assert.equal(PokeAudio.pickTrack(TRACKS, 'legendary'), null);
    assert.equal(PokeAudio.pickTrack([{ id: 'x', category: 'boss', enabled: false }], 'boss'), null);
});

test('pickTrack with an injected randomFn selects the expected index and never goes out of bounds', () => {
    const pool = TRACKS.filter(track => track.category === 'trainer' && track.enabled !== false);

    assert.equal(PokeAudio.pickTrack(TRACKS, 'trainer', () => 0), pool[0]);
    assert.equal(PokeAudio.pickTrack(TRACKS, 'trainer', () => 0.5), pool[1]);
    assert.equal(PokeAudio.pickTrack(TRACKS, 'trainer', () => 0.999), pool[pool.length - 1]);
    assert.equal(PokeAudio.pickTrack(TRACKS, 'trainer', () => 1), pool[pool.length - 1]);
});

test('setVolume clamps below 0 and above 1, and persists', () => {
    PokeAudio.setVolume(-5);
    assert.equal(PokeAudio.getVolume(), 0);

    let raw = JSON.parse(storageMap.get(PokeAudio.STORAGE_KEY));
    assert.equal(raw.version, 1);
    assert.equal(raw.volume, 0);

    PokeAudio.setVolume(5);
    assert.equal(PokeAudio.getVolume(), 1);

    raw = JSON.parse(storageMap.get(PokeAudio.STORAGE_KEY));
    assert.equal(raw.volume, 1);

    PokeAudio.setVolume(0.25);
    assert.equal(PokeAudio.getVolume(), 0.25);

    raw = JSON.parse(storageMap.get(PokeAudio.STORAGE_KEY));
    assert.equal(raw.volume, 0.25);
});

test('setMuted round-trips through storage', () => {
    assert.equal(PokeAudio.isMuted(), false);

    PokeAudio.setMuted(true);
    assert.equal(PokeAudio.isMuted(), true);

    let raw = JSON.parse(storageMap.get(PokeAudio.STORAGE_KEY));
    assert.equal(raw.muted, true);

    PokeAudio.setMuted(false);
    assert.equal(PokeAudio.isMuted(), false);

    raw = JSON.parse(storageMap.get(PokeAudio.STORAGE_KEY));
    assert.equal(raw.muted, false);
});

test('corrupt storage yields the defaults without throwing', () => {
    storageMap.set(PokeAudio.STORAGE_KEY, 'not json');
    assert.equal(PokeAudio.getVolume(), 0.6);
    assert.equal(PokeAudio.isMuted(), false);
});

test('an unrecognized settings version yields the defaults without throwing', () => {
    storageMap.set(PokeAudio.STORAGE_KEY, JSON.stringify({ version: 99, volume: 0.1, muted: true }));

    delete require.cache[AUDIO_PATH];
    require(AUDIO_PATH);
    const freshAudio = window.PokeAudio;

    assert.equal(freshAudio.getVolume(), 0.6);
    assert.equal(freshAudio.isMuted(), false);
});

test('playCategory with no Audio constructor returns the picked track or null and does not throw', () => {
    PokeAudio.configure(TRACKS);

    const track = PokeAudio.playCategory('boss');
    assert.equal(track.id, 'boss-a');
    assert.equal(PokeAudio.getCurrentTrack().id, 'boss-a');

    const silence = PokeAudio.playCategory('legendary');
    assert.equal(silence, null);
    assert.equal(PokeAudio.getCurrentTrack(), null);
});

test('configure(null) and playCategory for an unknown category are both safe no-ops', () => {
    assert.doesNotThrow(() => PokeAudio.configure(null));
    assert.equal(PokeAudio.playCategory('nope'), null);
});

test('resolveLevelTrack keeps the level track it is given', () => {
    assert.equal(PokeAudio.resolveLevelTrack(TRACKS, 'trainer-b').id, 'trainer-b');
});

test('resolveLevelTrack picks a fresh trainer track when the held one is missing or disabled', () => {
    // Disabled, gone, and "no track yet" all fall back to a random pick, and
    // that pick is always an enabled trainer track.
    ['trainer-c', 'deleted-track', null].forEach((trackId) => {
        const track = PokeAudio.resolveLevelTrack(TRACKS, trackId, () => 0.5);

        assert.equal(track.id, 'trainer-b');
    });
});

test('resolveLevelTrack never returns a battle-only track', () => {
    assert.equal(PokeAudio.resolveLevelTrack(TRACKS, 'boss-a', () => 0).id, 'trainer-a');
    assert.equal(PokeAudio.resolveLevelTrack([TRACKS[3]], null), null);
});

test('playLevelTrack holds one track and records its position for the next page', () => {
    PokeAudio.configure(TRACKS);

    const trackId = PokeAudio.playLevelTrack(null);

    assert.ok(trackId);
    assert.equal(PokeAudio.getCurrentTrack().id, trackId);

    const stored = JSON.parse(storageMap.get(PokeAudio.LEVEL_STORAGE_KEY));
    assert.equal(stored.trackId, trackId);
    assert.equal(stored.position, 0);

    // Asking again for the same track is a no-op, not a restart.
    assert.equal(PokeAudio.playLevelTrack(trackId), trackId);
    assert.equal(PokeAudio.getCurrentTrack().id, trackId);
});

test('a battle category interrupts the level track without losing it', () => {
    PokeAudio.configure(TRACKS);

    const trackId = PokeAudio.playLevelTrack(null);

    assert.equal(PokeAudio.playCategory('boss').id, 'boss-a');
    assert.equal(JSON.parse(storageMap.get(PokeAudio.LEVEL_STORAGE_KEY)).trackId, trackId);

    // Back on the map, the level's own track resumes.
    assert.equal(PokeAudio.playLevelTrack(trackId), trackId);
    assert.equal(PokeAudio.getCurrentTrack().id, trackId);
});

test('playLevelTrack is silence when no trainer track is available', () => {
    PokeAudio.configure([TRACKS[3]]);

    assert.equal(PokeAudio.playLevelTrack(null), null);
    assert.equal(PokeAudio.getCurrentTrack(), null);
});

test('resetLevelMusic stops playback and forgets the stored track', () => {
    PokeAudio.configure(TRACKS);
    PokeAudio.playLevelTrack(null);

    PokeAudio.resetLevelMusic();

    assert.equal(PokeAudio.getCurrentTrack(), null);
    assert.equal(storageMap.has(PokeAudio.LEVEL_STORAGE_KEY), false);
});
