// ==UserScript==
// @name         Geoduels UI Improved
// @icon         https://icons.duckduckgo.com/ip3/geoduels.io.ico
// @namespace    CSkUvkve7sr1zMhT
// @description  Adds a GeoGuessr-style GUI to geoduels!
// @version      1.0
// @updateURL    https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/GeoDuelsGUI.user.js
// @downloadURL  https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/GeoDuelsGUI.user.js
// @match        *://*.geoduels.io/*
// @match        *://*.googleusercontent.com/*
// @match        *://*.google.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- 0. GLOBAL AUDIO INTERCEPTOR ---
    const audioHook = document.createElement('script');
    audioHook.textContent = `
        window._gdAudioContexts = [];
        window._gdAudioElements = new Set();

        const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
        if (OriginalAudioContext) {
            window.AudioContext = new Proxy(OriginalAudioContext, {
                construct(target, args) {
                    const ctx = new target(...args);
                    window._gdAudioContexts.push(ctx);
                    if (localStorage.getItem('gd_ux_muted') === 'true') {
                        ctx.suspend();
                    }
                    return ctx;
                }
            });
        }

        const originalPlay = HTMLAudioElement.prototype.play;
        HTMLAudioElement.prototype.play = function() {
            window._gdAudioElements.add(this);
            if (localStorage.getItem('gd_ux_muted') === 'true') {
                this.muted = true;
            }
            return originalPlay.apply(this, arguments);
        };

        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'GD_UX_MUTE_STATE_CHANGED') {
                const isMuted = e.data.isMuted;

                window._gdAudioContexts.forEach(ctx => {
                    if (isMuted && ctx.state === 'running') ctx.suspend();
                    else if (!isMuted && ctx.state === 'suspended') ctx.resume();
                });

                window._gdAudioElements.forEach(audio => {
                    audio.muted = isMuted;
                });
            }
        });
    `;
    (document.head || document.documentElement).appendChild(audioHook);


    // --- Handles Zoom Layout & Parent Iframe Rules ---
    const frameStyle = document.createElement('style');
    frameStyle.textContent = `
        div.gmnoprint:has(> .gmnoprint[data-control-width="40"]) {
            position: fixed !important;
            left: 16px !important;
            bottom: 81px !important;
            top: auto !important;
            right: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            transform: none !important;
            z-index: 999999 !important;
            width: 48px !important;
            height: 140px !important;
            pointer-events: none !important;
        }
        .gmnoprint[data-control-width="40"] {
            position: absolute !important;
            left: 4px !important;
            bottom: 0px !important;
            top: auto !important;
            right: auto !important;
            margin: 0 !important;
            pointer-events: auto !important;
        }
        .gmnoprint[data-control-width="40"] > div {
            background-color: rgba(26, 26, 36, 0.85) !important;
            border-radius: 11px !important;
            backdrop-filter: blur(8px) !important;
            -webkit-backdrop-filter: blur(8px) !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        }
        .gmnoprint[data-control-width="40"] button {
            background: transparent !important;
            pointer-events: auto !important;
            cursor: pointer !important;
        }
        div.gmnoprint:has(> .gmnoprint[data-control-width="40"]) > div:has(> .gm-compass) {
            position: absolute !important;
            top: 0px !important;
            bottom: auto !important;
            left: 0px !important;
            right: auto !important;
            margin: 0 !important;
            z-index: 10 !important;
            pointer-events: auto !important;
        }
    `;
    (document.head || document.documentElement).appendChild(frameStyle);

    if (window.top !== window.self) {
        setInterval(() => {
            const zoomControl = document.querySelector('.gmnoprint[data-control-width="40"]');
            if (zoomControl && zoomControl.parentElement) {
                zoomControl.parentElement.style.setProperty('margin', '0', 'important');
                zoomControl.parentElement.style.setProperty('left', '16px', 'important');
                zoomControl.parentElement.style.setProperty('bottom', '81px', 'important');
            }
        }, 500);
    }

    // --- Intercept Engine & Track Position History ---
    const hookScript = document.createElement('script');
    hookScript.textContent = `
        (function(){
            let hooked = false;
            let svInstance = null;
            let movementHistory = [];
            let checkpointPosition = null;
            let blockNextRecord = false;

            function getCurrentLatLng() {
                const pos = svInstance && svInstance.getPosition ? svInstance.getPosition() : null;
                if (!pos) return null;
                return { lat: pos.lat(), lng: pos.lng() };
            }

            function samePos(a, b) {
                if (!a || !b) return false;
                return Math.abs(a.lat - b.lat) < 0.0000001 && Math.abs(a.lng - b.lng) < 0.0000001;
            }

            function applyHook() {
                if (hooked || !window.google || !window.google.maps || !window.google.maps.StreetViewPanorama) return;

                const OriginalSV = window.google.maps.StreetViewPanorama;
                window.google.maps.StreetViewPanorama = new Proxy(OriginalSV, {
                    construct(target, args) {
                        const instance = new target(...args);
                        svInstance = instance;
                        movementHistory = [];
                        checkpointPosition = null;

                        instance.addListener('pov_changed', () => {
                            window.top.postMessage({ type: 'GEO_COMPASS_UPDATE', heading: instance.getPov().heading }, '*');
                        });

                        instance.addListener('position_changed', () => {
                            if (blockNextRecord) {
                                blockNextRecord = false;
                                return;
                            }

                            const currentPos = getCurrentLatLng();
                            if (!currentPos) return;

                            const last = movementHistory[movementHistory.length - 1];
                            if (!last || !samePos(last, currentPos)) {
                                movementHistory.push(currentPos);
                            }
                        });

                        setTimeout(() => {
                            window.top.postMessage({ type: 'GEO_COMPASS_UPDATE', heading: instance.getPov().heading }, '*');
                            const currentPos = getCurrentLatLng();
                            if (currentPos) {
                                movementHistory = [currentPos];
                                checkpointPosition = currentPos;
                            }
                        }, 600);

                        return instance;
                    }
                });
                hooked = true;
            }

            window.addEventListener('message', (e) => {
                if (!e.data || !svInstance) return;

                if (e.data.type === 'GEO_EXECUTE_UNDO') {
                    if (movementHistory.length > 1) {
                        movementHistory.pop();
                        const targetPos = movementHistory[movementHistory.length - 1];
                        if (targetPos) {
                            blockNextRecord = true;
                            svInstance.setPosition(targetPos);
                        }
                    }
                } else if (e.data.type === 'GEO_SET_CHECKPOINT') {
                    const currentPos = getCurrentLatLng();
                    if (currentPos) {
                        checkpointPosition = currentPos;
                        movementHistory = [currentPos];
                    }
                } else if (e.data.type === 'GEO_RESET_TO_CHECKPOINT') {
                    if (checkpointPosition) {
                        blockNextRecord = true;
                        svInstance.setPosition(checkpointPosition);
                        movementHistory = [checkpointPosition];
                    }
                } else if (e.data.type === 'GEO_TELEPORT_AND_CLEAR') {
                    if (checkpointPosition) {
                        blockNextRecord = true;
                        svInstance.setPosition(checkpointPosition);
                        movementHistory = [checkpointPosition];
                        checkpointPosition = null;
                    }
                } else if (e.data.type === 'GEO_RESET_HISTORY') {
                    const currentPos = getCurrentLatLng();
                    movementHistory = currentPos ? [currentPos] : [];
                    checkpointPosition = currentPos || null;
                }
            });

            let interval = setInterval(applyHook, 10);
            setTimeout(() => clearInterval(interval), 10000);
        })();
    `;
    (document.head || document.documentElement).appendChild(hookScript);

    // --- Main ---
    if (window.top === window.self) {
        const initUI = setInterval(() => {
            if (document.body) {
                clearInterval(initUI);
                initializePlugin();
            }
        }, 50);
    }

    function initializePlugin() {
        const FADE_IN_DURATION = 1500;
        const FADE_OUT_DURATION = 600;
        const CROSSFADE_DURATION = 1500;

        const CONTAINER_WIDTH = 260;
        const PIXELS_PER_DEGREE = 2;

        let settings = {
            volume: parseFloat(localStorage.getItem('gd_ux_volume') ?? '0.4'),
            compassMode: localStorage.getItem('gd_ux_compass_mode') || 'modern',
            isMuted: localStorage.getItem('gd_ux_muted') === 'true'
        };

        if (settings.compassMode === 'both') {
            settings.compassMode = 'modern';
            localStorage.setItem('gd_ux_compass_mode', 'modern');
        }

        settings.compassEnabled = settings.compassMode !== 'classic';

        const rankedTracks = [
            new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/ranked_1.mp3"),
            new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/ranked_2.mp3"),
            new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/ranked_3.mp3"),
            new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/ranked_4.mp3")
        ];
        rankedTracks.forEach(track => { track.loop = true; track.fadeMultiplier = 0; });

        const soloAudio = new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/Chill_1.mp3");
        soloAudio.loop = true;
        soloAudio.fadeMultiplier = 0;

        let activeAudioObject = null;
        let browserInteracted = false;
        let currentRoundNum = 0;
        let insideMatchUrl = false;
        let isRankedGame = false;
        let tickCounter = 0;

        function applyAudioSettings() {
            const masterVol = settings.isMuted ? 0 : settings.volume;
            rankedTracks.forEach(track => {
                track.volume = masterVol * (track.fadeMultiplier || 0);
            });
            soloAudio.volume = masterVol * (soloAudio.fadeMultiplier || 0);

            window.postMessage({ type: 'GD_UX_MUTE_STATE_CHANGED', isMuted: settings.isMuted }, '*');
        }
        applyAudioSettings();

        function fadeTrackMultiplier(track, targetMultiplier, duration, onComplete) {
            if (!track) {
                if (onComplete) onComplete();
                return;
            }
            if (track.fadeInterval) clearInterval(track.fadeInterval);

            const startMultiplier = track.fadeMultiplier ?? 0;
            const startTime = performance.now();

            track.fadeInterval = setInterval(() => {
                const elapsed = performance.now() - startTime;
                let progress = elapsed / duration;
                if (progress > 1) progress = 1;

                track.fadeMultiplier = startMultiplier + (targetMultiplier - startMultiplier) * progress;
                applyAudioSettings();

                if (progress >= 1) {
                    clearInterval(track.fadeInterval);
                    track.fadeInterval = null;
                    if (onComplete) onComplete();
                }
            }, 16);
        }

        function playTrack(roundNum) {
            let targetAudio = null;

            if (!isRankedGame) {
                targetAudio = soloAudio;
            } else {
                let trackIdx = roundNum;
                if (trackIdx > 3) trackIdx = 3;
                if (trackIdx < 0) trackIdx = 0;
                targetAudio = rankedTracks[trackIdx];
            }

            if (activeAudioObject === targetAudio) {
                if (browserInteracted && targetAudio && targetAudio.paused) {
                    targetAudio.play().catch(() => {});
                }
                return;
            }

            const oldAudio = activeAudioObject;
            activeAudioObject = targetAudio;

            if (oldAudio && oldAudio !== targetAudio) {
                fadeTrackMultiplier(oldAudio, 0, CROSSFADE_DURATION, () => {
                    oldAudio.pause();
                    oldAudio.currentTime = 0;
                });

                if (targetAudio) {
                    targetAudio.fadeMultiplier = 0;
                    applyAudioSettings();
                    if (browserInteracted) {
                        targetAudio.play().catch(() => {});
                    }
                    fadeTrackMultiplier(targetAudio, 1, CROSSFADE_DURATION);
                }
            } else if (targetAudio) {
                targetAudio.fadeMultiplier = 0;
                applyAudioSettings();
                if (browserInteracted) {
                    targetAudio.play().catch(() => {});
                }
                fadeTrackMultiplier(targetAudio, 1, FADE_IN_DURATION);
            }
        }

        function stopAllMusic() {
            if (activeAudioObject) {
                const oldAudio = activeAudioObject;
                activeAudioObject = null;
                fadeTrackMultiplier(oldAudio, 0, FADE_OUT_DURATION, () => {
                    oldAudio.pause();
                    oldAudio.currentTime = 0;
                });
            }
        }

        function unlockAutoplay() {
            if (browserInteracted) return;
            browserInteracted = true;
            if (window.location.href.includes('/match/')) {
                playTrack(currentRoundNum);
            }
            window.removeEventListener('click', unlockAutoplay);
            window.removeEventListener('keydown', unlockAutoplay);
        }
        window.addEventListener('click', unlockAutoplay);
        window.addEventListener('keydown', unlockAutoplay);

        function postToAllFrames(message) {
            const frames = document.querySelectorAll('iframe');
            frames.forEach(frame => {
                try {
                    frame.contentWindow.postMessage(message, '*');
                } catch (_) {}
            });
        }

        function triggerUndoAction() { postToAllFrames({ type: 'GEO_EXECUTE_UNDO' }); }
        function triggerSetCheckpoint() { postToAllFrames({ type: 'GEO_SET_CHECKPOINT' }); }
        function triggerTeleportAndClear() { postToAllFrames({ type: 'GEO_TELEPORT_AND_CLEAR' }); }
        function triggerReturnToSpawn() {
            const btn = document.querySelector("button[aria-label='Return to spawn location']");
            if (btn) btn.click();
        }
        function broadcastHistoryWipe() { postToAllFrames({ type: 'GEO_RESET_HISTORY' }); }

        let checkpointActive = false;

        function setCheckpointGreen() {
            checkpointActive = true;
            const cpBtn = document.getElementById('gd-checkpoint-btn');
            if (cpBtn) {
                cpBtn.style.setProperty('background-color', 'rgba(34, 211, 133, 0.25)', 'important');
                cpBtn.style.setProperty('color', '#22d385', 'important');
                cpBtn.style.setProperty('border', '1.5px solid rgba(34, 211, 133, 0.6)', 'important');
                cpBtn.title = 'Return to checkpoint (X / C). Click again to teleport back.';
            }
        }

        function clearCheckpointGreen() {
            checkpointActive = false;
            const cpBtn = document.getElementById('gd-checkpoint-btn');
            if (cpBtn) {
                cpBtn.style.setProperty('background-color', 'rgba(7, 12, 18, 0.74)', 'important');
                cpBtn.style.setProperty('color', 'rgba(255, 255, 255, 0.8)', 'important');
                cpBtn.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.08)', 'important');
                cpBtn.title = 'Set checkpoint (X). Click again to return.';
            }
        }

        function handleCheckpointToggle() {
            if (!checkpointActive) {
                triggerSetCheckpoint();
                setCheckpointGreen();
            } else {
                triggerTeleportAndClear();
                clearCheckpointGreen();
            }
        }

        window.addEventListener('keydown', (e) => {
            if (!insideMatchUrl) return;
            if (
                document.activeElement &&
                (
                    document.activeElement.tagName === 'INPUT' ||
                    document.activeElement.tagName === 'TEXTAREA' ||
                    document.activeElement.isContentEditable
                )
            ) return;

            const key = e.key.toLowerCase();
            if (key === 'z') {
                e.preventDefault();
                triggerUndoAction();
            } else if (key === 'c' || key === 'x') {
                e.preventDefault();
                handleCheckpointToggle();
            } else if (key === 'r') {
                e.preventDefault();
                triggerReturnToSpawn();
            }
        }, true);

        window.addEventListener('message', (e) => {
            if (!e.data) return;
            if (e.data.type === 'GEO_COMPASS_UPDATE' && typeof e.data.heading === 'number') {
                targetHeading = e.data.heading;
            }
        });

        // --- UI Layer: Compass ---
        const compassContainer = document.createElement('div');
        compassContainer.id = 'gg-horizontal-compass-container';
        compassContainer.style.display = 'none';

        const compassStrip = document.createElement('div');
        compassStrip.id = 'gg-horizontal-compass-strip';

        const centerIndicator = document.createElement('div');
        centerIndicator.id = 'gg-compass-center-indicator';

        compassContainer.appendChild(compassStrip);
        compassContainer.appendChild(centerIndicator);
        document.body.appendChild(compassContainer);

        // --- Pause Menu ---
        const isCurrentlyFullscreen = !!document.fullscreenElement;

        const pauseModal = document.createElement('div');
        pauseModal.id = 'gd-pause-modal';
        pauseModal.style.display = 'none';
        pauseModal.innerHTML = `
            <div class="gd-modal-content" style="position: relative; overflow: hidden;">
                <h2 style="font-size: 24px; text-transform: uppercase; font-weight: 900; letter-spacing: 1px; margin-bottom: 24px; color: #ffffff;">SETTINGS</h2>

                <div class="gd-setting-group">
                    <div class="gd-setting-header">Effect Volume</div>
                    <input type="range" class="gd-slider" id="gd-effect-slider" min="0" max="100" value="50">
                </div>

                <div class="gd-setting-group" style="margin-bottom: 24px;">
                    <div class="gd-setting-header">Music Volume</div>
                    <input type="range" class="gd-slider" id="gd-volume-slider" min="0" max="100" value="${Math.round(settings.volume * 100)}">
                </div>

                <div class="gd-setting-group" style="margin-bottom: 24px;">
                    <div class="gd-setting-header">Compass</div>
                    <div class="gd-segmented-control" id="gd-compass-segment">
                        <button type="button" class="gd-segment-btn ${settings.compassMode === 'classic' ? 'active' : ''}" data-mode="classic">Classic</button>
                        <button type="button" class="gd-segment-btn ${settings.compassMode === 'modern' ? 'active' : ''}" data-mode="modern">Modern</button>
                    </div>
                </div>

                <div class="gd-setting-row">
                    <span class="gd-setting-label">Sound</span>
                    <div class="gd-toggle ${!settings.isMuted ? 'on' : ''}" id="gd-toggle-sound"></div>
                </div>

                <div class="gd-setting-row">
                    <span class="gd-setting-label">Fullscreen</span>
                    <div class="gd-toggle ${isCurrentlyFullscreen ? 'on' : ''}" id="gd-toggle-fs"></div>
                </div>

                <div class="gd-setting-row">
                    <span class="gd-setting-label">Game Chat</span>
                    <div class="gd-toggle on" id="gd-toggle-chat"></div>
                </div>

                <hr style="border: none; border-top: 1.5px solid rgba(255,255,255,0.08); margin: 24px 0 20px 0;">

                <div class="gd-modal-button-container" style="flex-direction: row; gap: 12px;">
                    <button type="button" id="gd-resume-btn" class="gd-btn gd-btn-primary" style="flex: 1;">RESUME</button>
                    <button type="button" id="gd-forfeit-trigger-btn" class="gd-btn gd-btn-danger" style="flex: 1;">LEAVE</button>
                </div>

                <div id="gd-confirm-overlay" style="display: none; position: absolute; inset: 0; background: #1a1a24; padding: 32px 24px; flex-direction: column; justify-content: center; align-items: center; z-index: 10;">
                    <div style="margin-bottom: 16px; display: flex; height: 44px; width: 44px; justify-content: center; border: 1.5px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.1); border-radius: 50%; color: #f87171; align-items: center;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>
                    </div>
                    <h3 style="margin: 0 0 6px 0; font-size: 18px; color: #ffffff; font-weight: 900; letter-spacing: 0.5px;">ARE YOU SURE?</h3>
                    <p style="font-size: 13px; color: rgba(255, 255, 255, 0.65); margin: 0 0 24px 0; line-height: 1.4; font-weight: 600; text-align: center;">This counts as a loss and ends the duel now.</p>
                    <div class="gd-modal-button-container" style="width: 100%; gap: 10px;">
                        <button type="button" id="gd-confirm-cancel-btn" class="gd-btn gd-btn-primary">KEEP PLAYING</button>
                        <button type="button" id="gd-confirm-accept-btn" class="gd-btn gd-btn-danger" style="background: rgba(239, 68, 68, 0.9); color: #ffffff; border: none; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);">CONFIRM FORFEIT</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(pauseModal);

        // --- Style Sheet ---
        const style = document.createElement('style');
        style.textContent = `
            button[aria-label="Forfeit match"] {
                position: absolute !important;
                opacity: 0 !important;
                pointer-events: none !important;
                width: 0 !important;
                height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                overflow: hidden !important;
            }

            /* Custom UI HUD Buttons Styling (Fixing the blur effect to match Zoom controls) */
            #gd-gear-pause-btn, #gd-checkpoint-btn, #gd-undo-move-btn {
                background-color: rgba(7, 12, 18, 0.74) !important;
                backdrop-filter: blur(8px) !important;
                -webkit-backdrop-filter: blur(8px) !important;
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
                color: rgba(255, 255, 255, 0.8) !important;
                transition: all 0.2s ease !important;
            }

            #gd-gear-pause-btn:hover, #gd-checkpoint-btn:hover, #gd-undo-move-btn:hover {
                background-color: rgba(255, 255, 255, 0.15) !important;
                color: #ffffff !important;
            }

            div:has(> button[aria-label="Forfeit match"]) {
                position: fixed !important;
                left: 66px !important;
                bottom: 14px !important;
                top: auto !important;
                right: auto !important;
                transform: none !important;
                margin: 0 !important;
                padding: 0 !important;
                z-index: 999999 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 44px !important;
                height: 44px !important;
                pointer-events: auto !important;
            }

            #gd-gear-pause-btn {
                position: fixed !important;
                left: 14px !important;
                bottom: 14px !important;
                z-index: 1000000 !important;
            }

            #gd-checkpoint-btn {
                position: fixed !important;
                left: 66px !important;
                bottom: 66px !important;
                z-index: 1000000 !important;
            }

            #gd-undo-move-btn {
                position: fixed !important;
                left: 66px !important;
                bottom: 118px !important;
                z-index: 1000000 !important;
            }

            .animate-hudSlideIn {
                transition: top 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }

            #gg-horizontal-compass-container {
                position: fixed;
                top: 12px;
                left: 50%;
                transform: translateX(-50%);
                width: ${CONTAINER_WIDTH}px;
                height: 28px;
                background: rgba(26, 26, 36, 0.75);
                border: 2px solid rgba(255, 255, 255, 0.25);
                border-radius: 20px;
                overflow: hidden;
                z-index: 999999;
                pointer-events: none;
                font-family: 'Neo Sans', Arial, sans-serif;
                color: #ffffff;
                box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            }
            #gg-horizontal-compass-strip {
                position: absolute;
                height: 100%;
                width: 100%;
                top: 0;
                left: 0;
                will-change: transform;
            }
            .compass-marker {
                position: absolute;
                top: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
                user-select: none;
            }
            .marker-text {
                font-size: 13px;
                font-weight: 800;
                letter-spacing: -0.5px;
            }
            .marker-tick {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.4);
                font-weight: normal;
            }
            #gg-compass-center-indicator {
                position: absolute;
                top: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 2px;
                height: 100%;
                background: #ffffff;
                box-shadow: 0 0 4px rgba(0,0,0,0.8);
            }

            #gd-pause-modal {
                position: fixed;
                inset: 0;
                background: rgba(10, 10, 15, 0.65);
                backdrop-filter: blur(6px);
                z-index: 9999999 !important; /* Raised extremely high to ensure it always obscures everything including buttons */
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: 'Neo Sans', Arial, sans-serif;
                animation: fadeIn 0.15s ease-out;
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .gd-modal-content {
                background: rgba(26, 26, 36, 0.97);
                border: 2px solid rgba(255, 255, 255, 0.12);
                border-radius: 24px;
                padding: 32px 36px;
                width: 380px;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.6);
            }

            /* Redesigned Menu Elements */
            .gd-setting-group { text-align: left; margin-bottom: 18px; }
            .gd-setting-header { font-size: 12px; font-weight: 800; color: rgba(255,255,255,0.85); margin-bottom: 8px; letter-spacing: 0.2px; }
            .gd-setting-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
            .gd-setting-label { font-size: 13px; font-weight: 700; color: #ffffff; letter-spacing: 0.2px;}

            /* Sliders */
            .gd-slider { -webkit-appearance: none; width: 100%; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; outline: none; transition: background 0.2s; }
            .gd-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; cursor: pointer; box-shadow: 0 0 6px rgba(0,0,0,0.4); }

            /* Segmented Control */
            .gd-segmented-control { display: flex; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden; }
            .gd-segment-btn { flex: 1; padding: 8px 0; border: none; background: transparent; color: rgba(255,255,255,0.5); font-size: 11px; font-weight: 700; cursor: pointer; transition: 0.2s; }
            .gd-segment-btn:hover { background: rgba(255,255,255,0.05); }
            .gd-segment-btn.active { background: rgba(255,255,255,0.15); color: #fff; }

            /* Toggles */
            .gd-toggle { position: relative; width: 38px; height: 20px; background: rgba(255,255,255,0.15); border-radius: 11px; cursor: pointer; transition: 0.3s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2); }
            .gd-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: 0.3s; }
            .gd-toggle.on { background: #22d385; }
            .gd-toggle.on::after { transform: translateX(18px); }

            /* Buttons */
            .gd-modal-button-container { display: flex; flex-direction: column; gap: 12px; }
            .gd-btn { width: 100%; padding: 12px 20px; font-size: 14px; font-weight: 800; letter-spacing: 0.2px; border-radius: 12px; cursor: pointer; transition: all 0.2s ease; border: none; outline: none; }
            .gd-btn-primary { background: #22d385; color: #ffffff; box-shadow: 0 4px 12px rgba(34, 211, 133, 0.3); }
            .gd-btn-primary:hover { background: #1cb873; transform: translateY(-1px); }
            .gd-btn-danger { background: rgba(239, 68, 68, 0.8); color: #ffffff; border: 1px solid rgba(239, 68, 68, 0.4); box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2); }
            .gd-btn-danger:hover { background: rgba(239, 68, 68, 1); transform: translateY(-1px); }
        `;
        document.head.appendChild(style);

        // --- Compass ---
        const points = [
            { name: 'N', deg: 0 },   { name: '|', deg: 15 },  { name: '|', deg: 30 },
            { name: 'NE', deg: 45 }, { name: '|', deg: 60 },  { name: '|', deg: 75 },
            { name: 'E', deg: 90 },  { name: '|', deg: 105 }, { name: '|', deg: 120 },
            { name: 'SE', deg: 135 }, { name: '|', deg: 150 }, { name: '|', deg: 165 },
            { name: 'S', deg: 180 }, { name: '|', deg: 195 }, { name: '|', deg: 210 },
            { name: 'SW', deg: 225 }, { name: '|', deg: 240 }, { name: '|', deg: 255 },
            { name: 'W', deg: 270 }, { name: '|', deg: 285 }, { name: '|', deg: 300 },
            { name: 'NW', deg: 315 }, { name: '|', deg: 330 }, { name: '|', deg: 345 }
        ];

        for (let i = -1; i <= 2; i++) {
            points.forEach(p => {
                const el = document.createElement('div');
                el.className = 'compass-marker ' + (p.name === '|' ? 'marker-tick' : 'marker-text');
                el.textContent = p.name;
                const degPosition = (i * 360) + p.deg;
                el.style.left = `${degPosition * PIXELS_PER_DEGREE}px`;
                compassStrip.appendChild(el);
            });
        }

        // --- Event Bindings ---
        const volumeSlider = document.getElementById('gd-volume-slider');
        volumeSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            settings.volume = val / 100;
            localStorage.setItem('gd_ux_volume', settings.volume.toString());
            applyAudioSettings();
        });

        const segmentBtns = document.querySelectorAll('.gd-segment-btn');
        segmentBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                segmentBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                settings.compassMode = e.target.getAttribute('data-mode');
                settings.compassEnabled = settings.compassMode !== 'classic';

                localStorage.setItem('gd_ux_compass_mode', settings.compassMode);
            });
        });

        const soundToggle = document.getElementById('gd-toggle-sound');
        soundToggle.addEventListener('click', () => {
            settings.isMuted = !settings.isMuted;
            localStorage.setItem('gd_ux_muted', settings.isMuted.toString());

            if (settings.isMuted) {
                soundToggle.classList.remove('on');
            } else {
                soundToggle.classList.add('on');
            }
            applyAudioSettings();
        });

        const fsToggle = document.getElementById('gd-toggle-fs');
        fsToggle.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        // Listen for hardware F11 
        document.addEventListener('fullscreenchange', () => {
            if (document.fullscreenElement) {
                fsToggle.classList.add('on');
            } else {
                fsToggle.classList.remove('on');
            }
        });

        // Chat Toggle 
        const chatToggle = document.getElementById('gd-toggle-chat');
        chatToggle.addEventListener('click', () => chatToggle.classList.toggle('on'));

        // --- Modal Navigation ---
        const confirmOverlay = document.getElementById('gd-confirm-overlay');

        document.getElementById('gd-resume-btn').addEventListener('click', () => {
            pauseModal.style.display = 'none';
            confirmOverlay.style.display = 'none';
        });

        document.getElementById('gd-forfeit-trigger-btn').addEventListener('click', () => {
            confirmOverlay.style.display = 'flex';
            if (activeTargetButton) {
                activeTargetButton.click();
            }
        });

        document.getElementById('gd-confirm-cancel-btn').addEventListener('click', () => {
            confirmOverlay.style.display = 'none';
            const nativeCancelBtn = Array.from(document.querySelectorAll('button'))
                .find(btn => btn.textContent.trim() === 'Keep Playing' || btn.getAttribute('aria-label') === 'Cancel forfeit' || btn.textContent.includes('Cancel'));
            if (nativeCancelBtn) nativeCancelBtn.click();
        });

        document.getElementById('gd-confirm-accept-btn').addEventListener('click', () => {
            const genuineConfirmBtn = Array.from(document.querySelectorAll('button'))
                .find(btn => btn.textContent.trim() === 'Confirm' || btn.textContent.includes('Forfeit') || btn.textContent.includes('Yes'));

            if (genuineConfirmBtn) {
                confirmOverlay.style.display = 'none';
                pauseModal.style.display = 'none';
                genuineConfirmBtn.click();
            }
        });

        // ---  Main Loop ---
        let targetHeading = 0;
        let currentHeading = 0;
        let activeTargetButton = null;

        function liveFrameWorker() {
            tickCounter++;

            if (window.location.href.includes('/match/')) {
                const healthBarExists = document.querySelector('[data-testid="player-name-row"]') !== null;

                if (!insideMatchUrl) {
                    insideMatchUrl = true;
                    currentRoundNum = 0;
                    isRankedGame = healthBarExists;
                    playTrack(0);
                    broadcastHistoryWipe();
                } else if (healthBarExists && !isRankedGame) {
                    isRankedGame = true;
                    playTrack(currentRoundNum);
                }

                if (tickCounter % 30 === 0) {
                    const placePinBtns = document.querySelectorAll('button');
                    for (let i = 0; i < placePinBtns.length; i++) {
                        if (placePinBtns[i].textContent && placePinBtns[i].textContent.toUpperCase().includes('PLACE PIN')) {
                            const widget = placePinBtns[i].closest('.absolute') || placePinBtns[i].parentElement.parentElement;
                            if (widget) {
                                widget.style.setProperty('right', '12px', 'important');
                                widget.style.setProperty('bottom', '12px', 'important');
                                widget.style.setProperty('margin-right', '0px', 'important');
                            }
                            break;
                        }
                    }
                }

                const roundSpan = Array.from(document.querySelectorAll('span')).find(el => el.textContent.includes('Round '));
                if (roundSpan) {
                    const match = roundSpan.textContent.match(/Round\s+(\d+)/i);
                    if (match) {
                        const parsedRound = parseInt(match[1], 10);
                        if (parsedRound !== currentRoundNum) {
                            currentRoundNum = parsedRound;
                            playTrack(currentRoundNum);
                            broadcastHistoryWipe();
                            clearCheckpointGreen();
                        }
                    }
                }

                const multiplierBadge = document.querySelector('[data-testid="timer-pill"], [data-testid="multiplier-badge"]');
                if (multiplierBadge) {
                    const badgeContainer = multiplierBadge.closest('.animate-hudSlideIn');
                    if (badgeContainer) {
                        badgeContainer.style.setProperty('top', '52px', 'important');
                    }
                }

                if (settings.compassEnabled) {
                    compassContainer.style.display = 'block';

                    let diff = targetHeading - currentHeading;
                    if (diff > 180) diff -= 360;
                    if (diff < -180) diff += 360;

                    if (Math.abs(diff) < 0.01) {
                        currentHeading = targetHeading;
                    } else {
                        currentHeading += diff * 0.25;
                    }

                    currentHeading = (currentHeading + 360) % 360;

                    const translationX = (CONTAINER_WIDTH / 2) - (currentHeading * PIXELS_PER_DEGREE);
                    compassStrip.style.transform = `translateX(${translationX}px)`;
                } else {
                    compassContainer.style.display = 'none';
                }

                const nativeForfeit = document.querySelector('button[aria-label="Forfeit match"]');
                if (nativeForfeit) {
                    activeTargetButton = nativeForfeit;

                    if (!document.getElementById('gd-gear-pause-btn')) {
                        const gearBtn = document.createElement('button');
                        gearBtn.id = 'gd-gear-pause-btn';
                        gearBtn.type = 'button';
                        gearBtn.ariaLabel = 'Open pause menu';
                        gearBtn.className = "flex h-11 w-11 items-center justify-center rounded-full";
                        gearBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        `;
                        gearBtn.addEventListener('click', () => {
                            pauseModal.style.display = 'flex';
                        });
                        document.body.appendChild(gearBtn);
                    }

                    if (!document.getElementById('gd-checkpoint-btn')) {
                        const checkpointBtn = document.createElement('button');
                        checkpointBtn.id = 'gd-checkpoint-btn';
                        checkpointBtn.type = 'button';
                        checkpointBtn.title = 'Set checkpoint (X). Click again to return.';
                        checkpointBtn.className = "flex h-11 w-11 items-center justify-center rounded-full";
                        checkpointBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                                <circle cx="12" cy="10" r="3"/>
                            </svg>
                        `;
                        checkpointBtn.addEventListener('click', handleCheckpointToggle);
                        document.body.appendChild(checkpointBtn);
                    }

                    if (!document.getElementById('gd-undo-move-btn')) {
                        const undoBtn = document.createElement('button');
                        undoBtn.id = 'gd-undo-move-btn';
                        undoBtn.type = 'button';
                        undoBtn.className = "flex h-11 w-11 items-center justify-center rounded-full";
                        undoBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M9 14 4 9l5-5"/>
                                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
                            </svg>
                        `;
                        undoBtn.addEventListener('click', triggerUndoAction);
                        document.body.appendChild(undoBtn);
                    }
                }
            } else {
                compassContainer.style.display = 'none';
                pauseModal.style.display = 'none';

                const currentGear = document.getElementById('gd-gear-pause-btn');
                if (currentGear) currentGear.remove();

                const currentUndo = document.getElementById('gd-undo-move-btn');
                if (currentUndo) currentUndo.remove();

                const currentCheckpoint = document.getElementById('gd-checkpoint-btn');
                if (currentCheckpoint) currentCheckpoint.remove();

                activeTargetButton = null;

                if (insideMatchUrl) {
                    insideMatchUrl = false;
                    isRankedGame = false;
                    clearCheckpointGreen();
                    stopAllMusic();
                }
            }

            requestAnimationFrame(liveFrameWorker);
        }

        requestAnimationFrame(liveFrameWorker);
    }
})();
