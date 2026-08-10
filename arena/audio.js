/**
 * Pocket Nuzlocke - battle music
 */

(function attachAudio(global) {
    'use strict';

    const STORAGE_KEY = 'pokemon-rogue-pocket-audio';
    const LEVEL_STORAGE_KEY = 'pokemon-rogue-pocket-audio-track';
    const STORAGE_VERSION = 1;
    const DEFAULT_VOLUME = 0.6;
    // The map level's own category: it plays on every page of a level and
    // through standard/ace trainer battles.
    const LEVEL_CATEGORY = 'trainer';
    const POSITION_SAVE_INTERVAL_MS = 1000;

    let settingsCache = null;
    let manifest = [];
    let element = null;
    let currentTrack = null;
    let retryArmed = false;
    let playingLevelTrack = false;
    let lastPositionSaveAt = 0;

    function canUseStorage() {
        return typeof localStorage !== 'undefined';
    }

    function normalizeSettings(raw) {
        const source = raw && typeof raw === 'object' && raw.version === STORAGE_VERSION ? raw : {};
        const volume = Number(source.volume);

        return {
            muted: Boolean(source.muted),
            version: STORAGE_VERSION,
            volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_VOLUME
        };
    }

    function loadSettings() {
        if (!canUseStorage()) return normalizeSettings(null);

        try {
            const raw = localStorage.getItem(STORAGE_KEY);

            return normalizeSettings(raw ? JSON.parse(raw) : null);
        } catch (error) {
            console.warn('Could not load audio settings.', error);
            return normalizeSettings(null);
        }
    }

    function saveSettings(settings) {
        if (!canUseStorage()) return false;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            return true;
        } catch (error) {
            console.warn('Could not save audio settings.', error);
            return false;
        }
    }

    function getSettings() {
        if (!settingsCache) settingsCache = loadSettings();
        return settingsCache;
    }

    function updateSettings(patch) {
        settingsCache = normalizeSettings(Object.assign({}, getSettings(), patch));
        saveSettings(settingsCache);
        applySettingsToElement();
        return settingsCache;
    }

    /**
     * The level track and how far into it the player is, kept in its own
     * storage key so it survives every page hop inside a map level.
     */
    function loadLevelState() {
        if (!canUseStorage()) return null;

        try {
            const raw = localStorage.getItem(LEVEL_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;

            if (!parsed || typeof parsed.trackId !== 'string' || !parsed.trackId) return null;

            const position = Number(parsed.position);

            return {
                position: Number.isFinite(position) && position > 0 ? position : 0,
                trackId: parsed.trackId
            };
        } catch (error) {
            console.warn('Could not load level music state.', error);
            return null;
        }
    }

    function saveLevelState(trackId, position) {
        if (!canUseStorage()) return false;

        try {
            localStorage.setItem(LEVEL_STORAGE_KEY, JSON.stringify({
                position: Number.isFinite(position) && position > 0 ? position : 0,
                trackId,
                version: STORAGE_VERSION
            }));

            return true;
        } catch (error) {
            console.warn('Could not save level music state.', error);
            return false;
        }
    }

    /**
     * Records how far into the level track playback has got, so the next page
     * picks the song up where this one left it. Throttled, because `timeupdate`
     * fires several times a second; `force` is for the page-unload flush.
     */
    function rememberPosition(force) {
        if (!playingLevelTrack || !element || !currentTrack) return;

        const now = Date.now();

        if (!force && now - lastPositionSaveAt < POSITION_SAVE_INTERVAL_MS) return;

        lastPositionSaveAt = now;
        saveLevelState(currentTrack.id, element.currentTime || 0);
    }

    /**
     * Picks one enabled track from a category, uniformly at random. Returns null
     * when the category is empty — the caller treats that as silence.
     */
    function pickTrack(tracks, category, randomFn) {
        const pool = (Array.isArray(tracks) ? tracks : [])
            .filter(track => track && track.enabled !== false && track.category === category);

        if (pool.length === 0) return null;

        const roll = typeof randomFn === 'function' ? randomFn() : Math.random();

        return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
    }

    function getElement() {
        if (element || typeof Audio === 'undefined') return element;

        element = new Audio();
        element.loop = true;
        element.preload = 'auto';
        element.addEventListener('timeupdate', () => rememberPosition(false));
        applySettingsToElement();

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            // Navigating to another page of the level is the moment the saved
            // position matters most, so flush it unthrottled on the way out.
            window.addEventListener('pagehide', () => rememberPosition(true));
        }

        return element;
    }

    function applySettingsToElement() {
        if (!element) return;

        const settings = getSettings();

        element.volume = settings.volume;
        element.muted = settings.muted;
    }

    /**
     * Browsers refuse playback until the page has seen a user gesture, and
     * game.html is reached by navigation. On refusal, arm ONE retry from the
     * next pointerdown/keydown and stay quiet until then.
     */
    function attemptPlay() {
        const audio = getElement();

        if (!audio || !currentTrack) return;

        const attempt = audio.play();

        if (!attempt || typeof attempt.catch !== 'function') return;

        attempt.catch(() => armAutoplayRetry());
    }

    function armAutoplayRetry() {
        if (retryArmed || typeof document === 'undefined') return;

        retryArmed = true;

        const retry = () => {
            document.removeEventListener('pointerdown', retry);
            document.removeEventListener('keydown', retry);
            retryArmed = false;
            attemptPlay();
        };

        document.addEventListener('pointerdown', retry);
        document.addEventListener('keydown', retry);
    }

    /**
     * Stores the track manifest for later playCategory() calls. Does not play
     * anything — configuring the module is separate from starting playback.
     */
    function configure(tracks) {
        manifest = Array.isArray(tracks) ? tracks : [];
    }

    /**
     * Loads a track into the element and starts it, seeking to `resumeAt` once
     * the metadata is in (currentTime cannot be set before that).
     */
    function startPlayback(track, resumeAt) {
        currentTrack = track;

        const audio = getElement();

        if (audio) {
            audio.src = track.file;

            if (resumeAt > 0) {
                audio.addEventListener('loadedmetadata', () => {
                    if (currentTrack !== track) return;
                    if (Number.isFinite(audio.duration) && resumeAt >= audio.duration) return;

                    audio.currentTime = resumeAt;
                }, { once: true });
            }

            applySettingsToElement();
        }

        if (!getSettings().muted) attemptPlay();

        return currentTrack;
    }

    /**
     * Picks and plays a random enabled track from the category. Idempotent for
     * the currently playing category so a re-render never restarts the song.
     * This is the boss / elite / legendary path — those battles get their own
     * song and leave the level track's saved position alone.
     */
    function playCategory(category) {
        if (currentTrack && currentTrack.category === category) {
            return currentTrack;
        }

        const track = pickTrack(manifest, category);

        if (!track) {
            stop();
            return null;
        }

        rememberPosition(true);
        playingLevelTrack = false;

        return startPlayback(track, 0);
    }

    /**
     * The track a map level should play: the one the level already chose, or a
     * fresh random pick when that id is gone, disabled, or absent.
     */
    function resolveLevelTrack(tracks, trackId, randomFn) {
        const held = trackId && (Array.isArray(tracks) ? tracks : []).find(track =>
            track && track.id === trackId && track.enabled !== false && track.category === LEVEL_CATEGORY);

        return held || pickTrack(tracks, LEVEL_CATEGORY, randomFn);
    }

    /**
     * Plays the level's music, resuming the stored position when this is the
     * same track the level was already playing. Returns the track id the caller
     * should store on the run (null when there is no music to play).
     *
     * Idempotent while that track is playing, so re-renders and page-internal
     * navigation never restart the song.
     */
    function playLevelTrack(trackId) {
        const track = resolveLevelTrack(manifest, trackId);

        if (!track) {
            stop();
            return null;
        }

        if (playingLevelTrack && currentTrack && currentTrack.id === track.id) {
            return track.id;
        }

        const stored = loadLevelState();
        // A freshly picked track always starts from the top, even if it happens
        // to be the song the previous level was playing.
        const resumeAt = trackId && stored && stored.trackId === track.id ? stored.position : 0;

        playingLevelTrack = true;
        lastPositionSaveAt = Date.now();
        saveLevelState(track.id, resumeAt);
        startPlayback(track, resumeAt);

        return track.id;
    }

    /**
     * Stops playback and forgets the current track.
     */
    function stop() {
        currentTrack = null;
        playingLevelTrack = false;

        if (!element) return;

        element.pause();
        element.currentTime = 0;
    }

    /**
     * Ends the level music for good — the run it belonged to is gone, so the
     * next run picks a fresh track from the top.
     */
    function resetLevelMusic() {
        stop();

        if (!canUseStorage()) return;

        try {
            localStorage.removeItem(LEVEL_STORAGE_KEY);
        } catch (error) {
            console.warn('Could not clear level music state.', error);
        }
    }

    function isMuted() {
        return getSettings().muted;
    }

    /**
     * setMuted(false) resumes the held track; setMuted(true) pauses but keeps
     * currentTrack so unmuting can resume it.
     */
    function setMuted(muted) {
        updateSettings({ muted: Boolean(muted) });

        if (muted) {
            rememberPosition(true);
            if (element) element.pause();
        } else {
            attemptPlay();
        }

        return getSettings().muted;
    }

    function getVolume() {
        return getSettings().volume;
    }

    function setVolume(volume) {
        const clamped = Math.min(1, Math.max(0, Number(volume)));

        updateSettings({ volume: Number.isFinite(clamped) ? clamped : DEFAULT_VOLUME });

        return getSettings().volume;
    }

    function getCurrentTrack() {
        return currentTrack;
    }

    global.PokeAudio = {
        configure,
        getCurrentTrack,
        getVolume,
        isMuted,
        pickTrack,
        playCategory,
        playLevelTrack,
        resetLevelMusic,
        resolveLevelTrack,
        setMuted,
        setVolume,
        stop,
        LEVEL_STORAGE_KEY,
        STORAGE_KEY
    };
})(window);
