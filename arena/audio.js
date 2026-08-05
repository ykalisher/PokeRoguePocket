/**
 * Pokemon Rogue Pocket - battle music
 */

(function attachAudio(global) {
    'use strict';

    const STORAGE_KEY = 'pokemon-rogue-pocket-audio';
    const STORAGE_VERSION = 1;
    const DEFAULT_VOLUME = 0.6;

    let settingsCache = null;
    let manifest = [];
    let element = null;
    let currentTrack = null;
    let retryArmed = false;

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
        applySettingsToElement();

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
     * Picks and plays a random enabled track from the category. Idempotent for
     * the currently playing category so a re-render never restarts the song.
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

        currentTrack = track;

        const audio = getElement();

        if (audio) {
            audio.src = track.file;
            applySettingsToElement();
        }

        if (!getSettings().muted) attemptPlay();

        return currentTrack;
    }

    /**
     * Stops playback and forgets the current track.
     */
    function stop() {
        currentTrack = null;

        if (!element) return;

        element.pause();
        element.currentTime = 0;
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
        setMuted,
        setVolume,
        stop,
        STORAGE_KEY
    };
})(window);
