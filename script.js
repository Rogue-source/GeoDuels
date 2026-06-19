// ==UserScript==
// @name         GeoDuels UX Enhancement Plugin
// @icon         https://icons.duckduckgo.com/ip3/geoduels.io.ico
// @namespace    CSkUvkve7sr1zMhT
// @description  Adds a GeoGuessr-style horizontal compass, shifts minimap, and moves forfeit action to a gear pause menu
// @version      3.5
// @match        *://*.geoduels.io/*
// @match        *://*.googleusercontent.com/*
// @match        *://*.google.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. CROSS-FRAME INJECTION: Pins Zoom Layout & native compass neatly on the left ---
    const frameStyle = document.createElement('style');
    frameStyle.textContent = `
        /* 1. The main wrapper for BOTH compass and zoom */
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
            pointer-events: none !important; /* Allow clicks to pass through empty spaces */
        }

        /* 2. The actual zoom control */
        .gmnoprint[data-control-width="40"] {
            position: absolute !important;
            left: 4px !important;
            bottom: 0px !important; /* Stick to bottom of the 140px wrapper */
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

        /* 3. The Compass Container */
        div.gmnoprint:has(> .gmnoprint[data-control-width="40"]) > div:has(> .gm-compass) {
            position: absolute !important;
            top: 0px !important; /* Stick to top of the 140px wrapper */
            bottom: auto !important;
            left: 0px !important;
            right: auto !important;
            margin: 0 !important;
            z-index: 10 !important;
            pointer-events: auto !important;
        }
    `;
    (document.head || document.documentElement).appendChild(frameStyle);

    // Backup Enforcer: Prevents Google Maps from snapping the wrapper back to left: 0
    if (window.top !== window.self) {
        setInterval(() => {
            const zoomControl = document.querySelector('.gmnoprint[data-control-width="40"]');
            if (zoomControl && zoomControl.parentElement) {
                zoomControl.parentElement.style.setProperty('margin', '0', 'important');
                zoomControl.parentElement.style.setProperty('left', '16px', 'important');
                zoomControl.parentElement.style.setProperty('bottom', '81px', 'important');
                zoomControl.parentElement.style.setProperty('top', 'auto', 'important');
            }
        }, 500);
    }

    // --- 2. GLOBAL HOOK: Intercept Google Maps API Engine for Top Compass ---
    const hookScript = document.createElement('script');
    hookScript.textContent = `
        (function(){
            let hooked = false;
            function applyHook() {
                if (hooked || !window.google || !window.google.maps || !window.google.maps.StreetViewPanorama) return;

                const OriginalSV = window.google.maps.StreetViewPanorama;
                window.google.maps.StreetViewPanorama = new Proxy(OriginalSV, {
                    construct(target, args) {
                        const instance = new target(...args);

                        // Broadcast orientation updates back to our compass script handler
                        instance.addListener('pov_changed', () => {
                            window.top.postMessage({type: 'GEO_COMPASS_UPDATE', heading: instance.getPov().heading}, '*');
                        });

                        setTimeout(() => {
                            window.top.postMessage({type: 'GEO_COMPASS_UPDATE', heading: instance.getPov().heading}, '*');
                        }, 500);

                        return instance;
                    }
                });
                hooked = true;
            }
            let interval = setInterval(applyHook, 10);
            setTimeout(() => clearInterval(interval), 10000);
        })();
    `;
    (document.head || document.documentElement).appendChild(hookScript);

    // --- 3. MAIN APPLICATION INFRASTRUCTURE ---
    if (window.top === window.self) {
        const initUI = setInterval(() => {
            if (document.body) {
                clearInterval(initUI);
                initializePlugin();
            }
        }, 50);
    }

    function initializePlugin() {
        const CONTAINER_WIDTH = 260;
        const PIXELS_PER_DEGREE = 2;

        let settings = {
            volume: parseFloat(localStorage.getItem('gd_ux_volume') ?? '0.4'),
            muted: localStorage.getItem('gd_ux_muted') === 'true',
            compassEnabled: localStorage.getItem('gd_ux_compass') !== 'false'
        };

        const rankedTracks = [
            new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/Ranked_1.mp3"),
            new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/ranked_2.mp3"),
            new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/ranked_3.mp3"),
            new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/ranked_4.mp3")
        ];
        rankedTracks.forEach(track => { track.loop = true; });

        const soloAudio = new Audio("https://raw.githubusercontent.com/Rogue-source/GeoDuels/main/Chill_1.mp3");
        soloAudio.loop = true;

        let activeAudioObject = null;
        let browserInteracted = false;
        let currentRoundNum = 0;
        let insideMatchUrl = false;
        let tickCounter = 0;

        function applyAudioSettings() {
            const liveVolume = settings.muted ? 0 : settings.volume;
            rankedTracks.forEach(track => { track.volume = liveVolume; });
            soloAudio.volume = liveVolume;
        }
        applyAudioSettings();

        function playTrack(roundNum) {
            const currentUrl = window.location.href;
            let targetAudio = null;

            if (currentUrl.includes('/match/solo-')) {
                targetAudio = soloAudio;
            } else if (currentUrl.includes('/match/')) {
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

            if (activeAudioObject) {
                activeAudioObject.pause();
                activeAudioObject.currentTime = 0;
            }

            activeAudioObject = targetAudio;

            if (activeAudioObject && browserInteracted) {
                applyAudioSettings();
                activeAudioObject.play().catch(() => {});
            }
        }

        function stopAllMusic() {
            if (activeAudioObject) {
                activeAudioObject.pause();
                activeAudioObject.currentTime = 0;
                activeAudioObject = null;
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

        // --- UI Layer: Custom Pause Modal Menu ---
        const pauseModal = document.createElement('div');
        pauseModal.id = 'gd-pause-modal';
        pauseModal.style.display = 'none';
        pauseModal.innerHTML = `
            <div class="gd-modal-content" style="position: relative; overflow: hidden;">
                <h2>MATCH PAUSED</h2>
                <div class="gd-setting-item" style="margin-bottom: 16px; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="gd-setting-label" style="color: rgba(255, 255, 255, 0.85); font-size: 12px; font-weight: 700;">Music Volume</span>
                        <span id="gd-volume-val" style="color: #22d385; font-size: 12px; font-weight: 700;">${Math.round(settings.volume * 100)}%</span>
                    </div>
                    <input type="range" id="gd-volume-slider" min="0" max="100" value="${Math.round(settings.volume * 100)}" style="width: 100%; margin-top: 8px; cursor: pointer;">
                </div>
                <div class="gd-setting-item" style="margin-bottom: 16px; text-align: left; display: flex; align-items: center; gap: 8px; cursor: pointer;" id="gd-mute-container">
                    <input type="checkbox" id="gd-mute-checkbox" ${settings.muted ? 'checked' : ''} style="cursor: pointer;">
                    <span class="gd-setting-label" style="color: rgba(255, 255, 255, 0.85); font-size: 12px; font-weight: 700; user-select: none;">Mute Music</span>
                </div>
                <div class="gd-setting-item" style="margin-bottom: 24px; text-align: left; display: flex; align-items: center; gap: 8px; cursor: pointer;" id="gd-compass-container-toggle">
                    <input type="checkbox" id="gd-compass-checkbox" ${settings.compassEnabled ? 'checked' : ''} style="cursor: pointer;">
                    <span class="gd-setting-label" style="color: rgba(255, 255, 255, 0.85); font-size: 12px; font-weight: 700; user-select: none;">Enable Compass</span>
                </div>
                <div class="gd-modal-button-container">
                    <button type="button" id="gd-resume-btn" class="gd-btn gd-btn-primary">RESUME MATCH</button>
                    <button type="button" id="gd-forfeit-trigger-btn" class="gd-btn gd-btn-danger">FORFEIT MATCH</button>
                </div>
                <div id="gd-confirm-overlay" style="display: none; position: absolute; inset: 0; background: #1a1a24; padding: 32px 24px; flex-direction: column; justify-content: center; align-items: center; z-index: 10;">
                    <div style="margin-bottom: 16px; display: flex; height: 44px; width: 44px; items-center; justify-content: center; border: 1.5px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.1); border-radius: 50%; color: #f87171; align-items: center;">
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

        // --- HUD Styling Custom Sheet ---
        const style = document.createElement('style');
        style.textContent = `
            /* Fixes the invisible HUD columns swallowing background clicks */
            .flex.items-center.gap-2:has(#gd-gear-pause-btn) {
                flex-direction: row !important;
                align-items: flex-end !important;
                position: fixed !important;
                left: 14px !important;
                bottom: 14px !important;
                gap: 8px !important;
                pointer-events: none !important;
            }
            .flex.items-center.gap-2:has(#gd-gear-pause-btn) > * {
                pointer-events: auto !important;
            }

            .gd-left-hud-col, .gd-right-hud-col {
                display: flex !important;
                flex-direction: column-reverse !important;
                gap: 8px !important;
                align-items: center !important;
                pointer-events: none !important;
            }
            .gd-left-hud-col > *, .gd-right-hud-col > * {
                pointer-events: auto !important;
            }

            .animate-hudSlideIn {
                transition: top 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }

            /* Compass Styling */
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

            /* Pause Modal Layout */
            #gd-pause-modal {
                position: fixed;
                inset: 0;
                background: rgba(10, 10, 15, 0.65);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                z-index: 1000000;
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
                background: rgba(26, 26, 36, 0.92);
                border: 2px solid rgba(255, 255, 255, 0.15);
                border-radius: 24px;
                padding: 32px 40px;
                width: 340px;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.6);
            }
            .gd-modal-content h2 {
                color: #ffffff;
                font-size: 22px;
                font-weight: 900;
                letter-spacing: 0.5px;
                margin-bottom: 24px;
            }
            .gd-modal-button-container {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .gd-btn {
                width: 100%;
                padding: 12px 20px;
                font-size: 14px;
                font-weight: 800;
                letter-spacing: 0.2px;
                border-radius: 12px;
                cursor: pointer;
                transition: all 0.2s ease;
                border: none;
                outline: none;
            }
            .gd-btn-primary {
                background: #22d385;
                color: #ffffff;
                box-shadow: 0 4px 12px rgba(34, 211, 133, 0.3);
            }
            .gd-btn-primary:hover {
                background: #1cb873;
                transform: translateY(-1px);
            }
            .gd-btn-danger {
                background: rgba(239, 68, 68, 0.2);
                color: #f87171;
                border: 1.5px solid rgba(239, 68, 68, 0.4);
            }
            .gd-btn-danger:hover {
                background: rgba(239, 68, 68, 0.3);
                color: #ffffff;
            }
            #gd-gear-pause-btn ~ div {
                display: none !important;
            }
        `;
        document.head.appendChild(style);

        // --- Ribbon Layout Assembly ---
        const points = [
            { name: 'N', deg: 0 },   { name: '|', deg: 15 },  { name: '|', deg: 30 },
            { name: 'NE', deg: 45 }, { name: '|', deg: 60 },  { name: '|', deg: 75 },
            { name: 'E', deg: 90 },   { name: '|', deg: 105 }, { name: '|', deg: 120 },
            { name: 'SE', deg: 135 }, { name: '|', deg: 150 }, { name: '|', deg: 165 },
            { name: 'S', deg: 180 },  { name: '|', deg: 195 }, { name: '|', deg: 210 },
            { name: 'SW', deg: 225 }, { name: '|', deg: 240 }, { name: '|', deg: 255 },
            { name: 'W', deg: 270 },  { name: '|', deg: 285 }, { name: '|', deg: 300 },
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

        // --- Settings Panel Input Event Bindings ---
        const volumeSlider = document.getElementById('gd-volume-slider');
        const volumeVal = document.getElementById('gd-volume-val');
        volumeSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            volumeVal.textContent = val + '%';
            settings.volume = val / 100;
            localStorage.setItem('gd_ux_volume', settings.volume.toString());
            applyAudioSettings();
        });

        const muteCheckbox = document.getElementById('gd-mute-checkbox');
        muteCheckbox.addEventListener('change', (e) => {
            settings.muted = e.target.checked;
            localStorage.setItem('gd_ux_muted', settings.muted.toString());
            applyAudioSettings();
        });

        document.getElementById('gd-mute-container').addEventListener('click', (e) => {
            if (e.target !== muteCheckbox) {
                muteCheckbox.checked = !muteCheckbox.checked;
                settings.muted = muteCheckbox.checked;
                localStorage.setItem('gd_ux_muted', settings.muted.toString());
                applyAudioSettings();
            }
        });

        const compassCheckbox = document.getElementById('gd-compass-checkbox');
        compassCheckbox.addEventListener('change', (e) => {
            settings.compassEnabled = e.target.checked;
            localStorage.setItem('gd_ux_compass', settings.compassEnabled.toString());
        });

        document.getElementById('gd-compass-container-toggle').addEventListener('click', (e) => {
            if (e.target !== compassCheckbox) {
                compassCheckbox.checked = !compassCheckbox.checked;
                settings.compassEnabled = compassCheckbox.checked;
                localStorage.setItem('gd_ux_compass', settings.compassEnabled.toString());
            }
        });

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
            const nativeGearBtn = document.getElementById('gd-gear-pause-btn');
            if (nativeGearBtn && nativeGearBtn.parentElement) {
                const nativeCancelBtn = Array.from(nativeGearBtn.parentElement.querySelectorAll('button'))
                    .find(btn => btn.textContent.trim() === 'Keep Playing' || btn.getAttribute('aria-label') === 'Cancel forfeit');
                if (nativeCancelBtn) nativeCancelBtn.click();
            }
        });

        document.getElementById('gd-confirm-accept-btn').addEventListener('click', () => {
            const nativeGearBtn = document.getElementById('gd-gear-pause-btn');
            if (nativeGearBtn && nativeGearBtn.parentElement) {
                const nativeButtons = Array.from(nativeGearBtn.parentElement.querySelectorAll('button'));
                const genuineConfirmBtn = nativeButtons.find(btn => btn.textContent.trim() === 'Confirm');

                if (genuineConfirmBtn) {
                    confirmOverlay.style.display = 'none';
                    pauseModal.style.display = 'none';
                    genuineConfirmBtn.click();
                }
            }
        });

        // --- 4. Main Continuous Sync State Loop ---
        let targetHeading = 0;
        let currentHeading = 0;
        let activeTargetButton = null;

        window.addEventListener('message', (e) => {
            if (e.data?.type === 'GEO_COMPASS_UPDATE' && typeof e.data.heading === 'number') {
                targetHeading = e.data.heading;
            }
        });

        function liveFrameWorker() {
            tickCounter++;
            if (window.location.href.includes('/match/')) {
                if (!insideMatchUrl) {
                    insideMatchUrl = true;
                    currentRoundNum = 0;
                    playTrack(0);
                }

                // Push Minimap tightly into the corner (runs slightly throttled to save CPU)
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

                // Dynamic Action Layout Substitution Assembly
                const nativeForfeit = document.querySelector('button[aria-label="Forfeit match"]');
                if (nativeForfeit && nativeForfeit.style.opacity !== '0') {
                    activeTargetButton = nativeForfeit;

                    nativeForfeit.style.setProperty('position', 'absolute', 'important');
                    nativeForfeit.style.setProperty('opacity', '0', 'important');
                    nativeForfeit.style.setProperty('pointer-events', 'none', 'important');
                    nativeForfeit.style.setProperty('width', '0', 'important');
                    nativeForfeit.style.setProperty('height', '0', 'important');

                    const parentContainer = nativeForfeit.parentNode;

                    let leftCol = document.getElementById('gd-hud-left-column');
                    let rightCol = document.getElementById('gd-hud-right-column');

                    if (!leftCol) {
                        leftCol = document.createElement('div');
                        leftCol.id = 'gd-hud-left-column';
                        leftCol.className = 'gd-left-hud-col';
                        parentContainer.appendChild(leftCol);
                    }
                    if (!rightCol) {
                        rightCol = document.createElement('div');
                        rightCol.id = 'gd-hud-right-column';
                        rightCol.className = 'gd-right-hud-col';
                        parentContainer.appendChild(rightCol);
                    }

                    // Left Column Setup: Gear button
                    if (!document.getElementById('gd-gear-pause-btn')) {
                        const gearBtn = document.createElement('button');
                        gearBtn.id = 'gd-gear-pause-btn';
                        gearBtn.type = 'button';
                        gearBtn.ariaLabel = 'Open pause menu';
                        gearBtn.className = "flex h-11 w-11 items-center justify-center rounded-full bg-hudBg text-white/80 shadow-elev-2 backdrop-blur-hud transition hover:bg-white/10 hover:text-white";
                        gearBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        `;
                        gearBtn.addEventListener('click', () => {
                            pauseModal.style.display = 'flex';
                        });
                        leftCol.appendChild(gearBtn);
                    }

                    // Right Column Setup: Flag -> Checkpoint -> Undo Stack
                    const flagBtn = parentContainer.querySelector('button[aria-label="Return to spawn location"]');
                    if (flagBtn && flagBtn.parentNode !== rightCol) {
                        rightCol.appendChild(flagBtn);
                    }

                    if (!document.getElementById('gd-checkpoint-btn')) {
                        const checkpointBtn = document.createElement('button');
                        checkpointBtn.id = 'gd-checkpoint-btn';
                        checkpointBtn.type = 'button';
                        checkpointBtn.className = "flex h-11 w-11 items-center justify-center rounded-full bg-hudBg text-white/80 shadow-elev-2 backdrop-blur-hud transition hover:bg-white/10 hover:text-white";
                        checkpointBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                                <circle cx="12" cy="10" r="3"/>
                            </svg>
                        `;
                        rightCol.appendChild(checkpointBtn);
                    }

                    if (!document.getElementById('gd-undo-move-btn')) {
                        const undoBtn = document.createElement('button');
                        undoBtn.id = 'gd-undo-move-btn';
                        undoBtn.type = 'button';
                        undoBtn.className = "flex h-11 w-11 items-center justify-center rounded-full bg-hudBg text-white/80 shadow-elev-2 backdrop-blur-hud transition hover:bg-white/10 hover:text-white";
                        undoBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M9 14 4 9l5-5"/>
                                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
                            </svg>
                        `;
                        rightCol.appendChild(undoBtn);
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

                const leftCol = document.getElementById('gd-hud-left-column');
                if (leftCol) leftCol.remove();

                const rightCol = document.getElementById('gd-hud-right-column');
                if (rightCol) rightCol.remove();

                activeTargetButton = null;

                if (insideMatchUrl) {
                    insideMatchUrl = false;
                    stopAllMusic();
                }
            }

            requestAnimationFrame(liveFrameWorker);
        }
        requestAnimationFrame(liveFrameWorker);
    }
})();