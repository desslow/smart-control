// ==UserScript==
// @name         Ozon Smart Control
// @namespace    http://tampermonkey.net/
// @version      8.7
// @description  Клавиатурный режим выдачи заказов.
// @author       desslow
// @match        https://*.ozon.ru/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    window._ozonAuthHeaders = null;
    let sessionsMap = new Map();
    let currentPostingsData = null;
    let currentSessionId = null;
    let currentFoundAtTimestamp = null;
    let totalUnpaidDebt = 0;

    function handleSessionsData(data) {
        if (!data || !Array.isArray(data.sessions)) return;
        data.sessions.forEach(s => {
            if (s.sessionId && s.foundAt) {
                const ts = new Date(s.foundAt).getTime();
                sessionsMap.set(String(s.sessionId), ts);
                localStorage.setItem(`ozon_found_at_${s.sessionId}`, String(ts));
            }
        });
    }

    function handlePostingsData(data, url) {
        if (!data || !Array.isArray(data.postings)) return;
        currentPostingsData = data.postings;

        // Считаем актуальный долг текущего клиента
        totalUnpaidDebt = currentPostingsData.reduce((acc, p) => acc + (p.clientAmount || 0), 0);

        if (totalUnpaidDebt > 0) {
            triggerScreenPerimeterPulse();
        }
        updateStatusSlotUI();
    }

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._smartUrl = typeof url === 'string' ? url : '';
        this._smartHeaders = {};
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (this._smartHeaders) this._smartHeaders[name.toLowerCase()] = value;
        return origSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        if (this._smartHeaders && this._smartHeaders['authorization']) {
            window._ozonAuthHeaders = {
                'authorization': this._smartHeaders['authorization'],
                'x-o3-app-name': this._smartHeaders['x-o3-app-name'] || 'turbo-pvz-ui',
                'x-o3-app-version': this._smartHeaders['x-o3-app-version'] || '',
                'x-o3-version-name': this._smartHeaders['x-o3-version-name'] || ''
            };
        }

        this.addEventListener('load', function() {
            try {
                const url = this._smartUrl || '';
                if (url.includes('/api2/giveout/Sessions')) handleSessionsData(JSON.parse(this.responseText));
                if (url.includes('/api2/giveout/Postings')) handlePostingsData(JSON.parse(this.responseText), url);
            } catch (e) {}
        });

        return origSend.apply(this, arguments);
    };

    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        try {
            const config = args[1];
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

            if (config && config.headers) {
                let headersObj = new Headers(config.headers);
                if (headersObj.has('authorization')) {
                    window._ozonAuthHeaders = {
                        'authorization': headersObj.get('authorization'),
                        'x-o3-app-name': headersObj.get('x-o3-app-name') || 'turbo-pvz-ui',
                        'x-o3-app-version': headersObj.get('x-o3-app-version') || '',
                        'x-o3-version-name': headersObj.get('x-o3-version-name') || ''
                    };
                }
            }

            const response = await origFetch.apply(this, args);
            if (url.includes('/api2/giveout/Sessions')) response.clone().json().then(handleSessionsData).catch(() => {});
            if (url.includes('/api2/giveout/Postings')) response.clone().json().then(d => handlePostingsData(d, url)).catch(() => {});

            return response;
        } catch (e) {
            return origFetch.apply(this, args);
        }
    };

    // 1. Для работы клавиатуры (как в v7.9)
    function isOrdersPage() {
        const path = window.location.pathname;
        return path.includes('/orders') && !path.includes('/outbound');
    }

    function isSessionActive() {
        return window.location.pathname.includes('/orders/session');
    }

    function getCurrentSessionIdFromUrl() {
        const match = window.location.pathname.match(/\/orders\/session(?:-new)?\/(\d+)/);
        return match ? match[1] : null;
    }

    const KEY_ENTER = 'NumpadEnter';
    const KEY_ADD = 'NumpadAdd';
    const KEY_SUBTRACT = 'NumpadSubtract';
    const KEY_MULTIPLY = 'NumpadMultiply';
    const KEY_CHECK = 'Numpad0';
    const REASON_KEYS = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5'];

    const RUS_TO_ENG = {
        'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p',
        'х': '[', 'ъ': ']', 'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k',
        'д': 'l', 'ж': ';', 'э': "'", 'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm',
        'б': ',', 'ю': '.', '.': '/', 'Ё': '~', 'ё': '`',
        'Й': 'Q', 'Ц': 'W', 'У': 'E', 'К': 'R', 'Е': 'T', 'Н': 'Y', 'Г': 'U', 'Ш': 'I', 'Щ': 'O', 'З': 'P',
        'Х': '{', 'Ъ': '}', 'Ф': 'A', 'Ы': 'S', 'В': 'D', 'А': 'F', 'П': 'G', 'Р': 'H', 'О': 'J', 'Л': 'K',
        'Д': 'L', 'Ж': ':', 'Э': '"', 'Я': 'Z', 'Ч': 'X', 'С': 'C', 'М': 'V', 'И': 'B', 'Т': 'N', 'Ь': 'M',
        'Б': '<', 'Ю': '>', ',': '?'
    };

    const CIS_PATTERN = /^[^a-zA-Z0-9]*01\d{13,14}21.+$/;

    // Состояние скрипта
    let activePackageIndex = 0;
    let activeBarcode = '';
    let lastScannedBarcode = '';
    let lastScanTime = 0;
    let lastSuccessCard = null;

    let scanBuffer = '';
    let lastScanKeyTime = Date.now();
    let enterHoldTimeout = null;
    let isEnterHolding = false;
    let enterCompleted = false; // Защита от повторного клика при удержании
    let heldButton = null;
    let enterBlockUntil = 0;

    let numpad0Presses = 0;
    let numpad0Timer = null;
    let numpadReasonPresses = {};
    let numpadReasonTimers = {};

    let audioCtx = null;
    let isMouseDown = false;
    let isDraggingSelection = false;

    // Фокус-мод
    let isFocusMode = false;
    let rCtrlPresses = 0;
    let rCtrlTimer = null;
    let isRightCtrlHeld = false;

    const style = document.createElement('style');
    style.innerHTML = `
        [class*="_card_"], [class*="_item_"], #smart-control-panel {
            user-select: none !important;
            -webkit-user-select: none !important;
        }
        body.smart-no-select {
            user-select: none !important;
            -webkit-user-select: none !important;
        }

        /* Плавное выплывание панели снизу вверх */
        @keyframes slideUpPanel {
            0% {
                opacity: 0;
                transform: translate(-50%, 35px) scale(0.96);
            }
            100% {
                opacity: 1;
                transform: translate(-50%, 0) scale(1);
            }
        }

        #smart-control-panel {
            position: fixed;
            bottom: 14px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(18, 24, 38, 0.96);
            backdrop-filter: blur(14px);
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 14px;
            padding: 6px 12px;
            display: flex;
            align-items: center;
            gap: 7px;
            box-shadow: 0 10px 35px rgba(0, 0, 0, 0.65);
            z-index: 999999;
            box-sizing: border-box;
            animation: slideUpPanel 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        /* Фокус на стрелки */
        .smart-control-focus {
            outline: 4px solid #ff9800 !important;
            outline-offset: -2px !important;
            box-shadow: 0 0 14px rgba(255, 152, 0, 0.85) !important;
            border-radius: 14px;
            transition: all 0.15s ease-out;
            transform: scale(1.01) !important;
            z-index: 10 !important;
        }

        /* Выделенные карточки */
        .smart-control-selected {
            outline: 3px solid #ff9800 !important;
            outline-offset: -2px !important;
            background-color: rgba(255, 152, 0, 0.08) !important;
            position: relative;
        }
        .smart-control-selected::after {
            content: '✓';
            position: absolute;
            top: 10px;
            right: 10px;
            background: #ff9800;
            color: #ffffff;
            font-size: 13px;
            font-weight: 900;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            z-index: 15;
            pointer-events: none;
        }

        /* Неоновый циан при фокусе на уже выбранном товаре */
        .smart-control-selected.smart-control-focus {
            outline: 5px solid #00f0ff !important;
            box-shadow: 0 0 22px rgba(0, 240, 255, 0.95), inset 0 0 10px rgba(0, 240, 255, 0.4) !important;
            transform: scale(1.025) !important;
            z-index: 25 !important;
        }

        /* Размытие по Гауссу невыбранных товаров */
        body.smart-focus-active [class*="_card_"]:not(.smart-control-selected):not(.smart-control-focus) {
            filter: blur(6px) opacity(0.35) !important;
            pointer-events: none !important;
            transition: filter 0.3s ease, opacity 0.3s ease !important;
        }

        /* Фикс шрифта ячеек КГТ */
        [class*="_addressBadge_"] {
            white-space: nowrap !important;
            max-width: 100% !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        /* Пульсация по периметру экрана */
        @keyframes perimeter-glow-flash {
            0%   { box-shadow: inset 0 0 0px rgba(239, 68, 68, 0); }
            50%  { box-shadow: inset 0 0 45px rgba(239, 68, 68, 0.9), inset 0 0 90px rgba(239, 68, 68, 0.5); }
            100% { box-shadow: inset 0 0 0px rgba(239, 68, 68, 0); }
        }
        .smart-perimeter-pulse {
            animation: perimeter-glow-flash 0.5s ease-in-out !important;
        }

        /* Анимация прогресса удержания кнопки Enter */
        .smart-btn-progress { position: relative !important; overflow: hidden !important; }
        .smart-btn-progress::after {
            content: ''; position: absolute; top: 0; left: 0; bottom: 0;
            width: var(--smart-progress, 0%); background-color: rgba(228, 0, 124, 0.55) !important;
            transition: width 0.4s linear, opacity 0.2s ease-out; pointer-events: none; z-index: 10; border-radius: inherit;
        }
        .smart-btn-progress.done::after { opacity: 0; }

        .smart-panel-btn {
            color: #ffffff;
            border: none;
            padding: 6px 10px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
        }
        .smart-panel-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
        .smart-panel-btn:active { transform: scale(0.96); }

        .btn-check   { background: #005bff !important; }
        .btn-giveout { background: #10b981 !important; }
        .btn-refuse  { background: #ef4444 !important; }
        .btn-keep    { background: #4b5563 !important; }
        .btn-more    { background: rgba(255, 255, 255, 0.1) !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; }

        .smart-keycap {
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 4px;
            padding: 1px 4px;
            font-size: 10px;
            font-family: monospace;
            font-weight: 700;
            color: #ececec;
            letter-spacing: -0.2px;
            pointer-events: none;
        }

        .smart-panel-timer {
            color: #ff9800;
            font-family: monospace;
            font-size: 13px;
            font-weight: bold;
            padding: 4px 7px;
            background: rgba(255, 152, 0, 0.15);
            border: 1px solid rgba(255, 152, 0, 0.35);
            border-radius: 6px;
            white-space: nowrap;
        }

        @keyframes pulse-neon {
            0%   { box-shadow: 0 0 6px rgba(239, 68, 68, 0.5); border-color: rgba(239, 68, 68, 0.6); }
            50%  { box-shadow: 0 0 18px rgba(239, 68, 68, 0.95); border-color: #ef4444; }
            100% { box-shadow: 0 0 6px rgba(239, 68, 68, 0.5); border-color: rgba(239, 68, 68, 0.6); }
        }
        @keyframes blink-dot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50%      { opacity: 0.3; transform: scale(0.8); }
        }
        .pay-needed {
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(185, 28, 28, 0.45)) !important;
            color: #fff !important;
            border: 1px solid #ef4444 !important;
            animation: pulse-neon 1.6s infinite ease-in-out;
            font-size: 12px;
            font-weight: bold;
            padding: 4px 8px;
            border-radius: 6px;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .pay-needed .pay-dot {
            display: inline-block;
            width: 7px;
            height: 7px;
            background-color: #ef4444;
            border-radius: 50%;
            animation: blink-dot 0.8s infinite ease-in-out;
        }

        .smart-focus-slot-btn {
            font-size: 12px;
            font-weight: 600;
            padding: 4px 8px;
            border-radius: 6px;
            cursor: pointer;
            white-space: nowrap;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
        }
        .smart-focus-slot-btn.active {
            background: rgba(0, 240, 255, 0.18) !important;
            border: 1px solid #00f0ff !important;
            color: #00f0ff !important;
            box-shadow: 0 0 10px rgba(0, 240, 255, 0.35);
        }
        .smart-focus-slot-btn.inactive {
            background: rgba(255, 255, 255, 0.08) !important;
            border: 1px solid rgba(255, 255, 255, 0.16) !important;
            color: #bbb !important;
        }
        .smart-focus-slot-btn.inactive:hover {
            background: rgba(255, 255, 255, 0.15) !important;
            color: #fff !important;
        }

        #smart-more-dropdown {
            position: absolute;
            bottom: calc(100% + 8px);
            right: 0;
            background: rgba(22, 29, 45, 0.98);
            backdrop-filter: blur(14px);
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 10px;
            padding: 6px;
            display: none;
            flex-direction: column;
            gap: 4px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
            z-index: 1000000;
        }
        #smart-more-dropdown.show { display: flex !important; }
        .smart-dropdown-item {
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
            border: none;
            padding: 7px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            text-align: left;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            white-space: nowrap;
            transition: all 0.15s;
        }
        .smart-dropdown-item:hover { background: rgba(255, 255, 255, 0.18); }

        .smart-btn-countdown-locked {
            position: relative !important;
            overflow: hidden !important;
            pointer-events: none !important;
            filter: grayscale(0.2) !important;
            cursor: not-allowed !important;
        }
        .smart-btn-countdown-bar {
            position: absolute;
            top: 0; left: 0; bottom: 0;
            width: 100%;
            background: rgba(239, 68, 68, 0.4) !important;
            transition: width 1s linear;
            z-index: 5;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);

    function triggerScreenPerimeterPulse() {
        const content = document.querySelector('[class*="_content_"]') || document.querySelector('[class*="_page_"]');
        const target = (content && content.parentElement) || content || document.body;

        target.classList.remove('smart-perimeter-pulse');
        void target.offsetWidth;
        target.classList.add('smart-perimeter-pulse');
        setTimeout(() => target.classList.remove('smart-perimeter-pulse'), 550);
    }

    function fixKgtShelves() {
        document.querySelectorAll('[class*="_addressBadge_"]').forEach(badge => {
            const text = badge.textContent.trim();
            if (text.includes('КГТ') || text.length > 7) {
                badge.style.setProperty('font-size', '32px', 'important');
                badge.style.setProperty('line-height', '26px', 'important');
                badge.style.setProperty('white-space', 'nowrap', 'important');
                badge.style.setProperty('letter-spacing', '-0.4px', 'important');
            }
        });
    }

    function updateSessionTimerUI() {
        const timerEl = document.getElementById('smart-session-timer');
        if (!timerEl) return;

        const sessionId = getCurrentSessionIdFromUrl();
        if (sessionId && sessionId !== currentSessionId) {
            currentSessionId = sessionId;
            totalUnpaidDebt = 0;

            let foundAtTime = sessionsMap.get(String(sessionId));
            if (!foundAtTime) {
                const cached = localStorage.getItem(`ozon_found_at_${sessionId}`);
                if (cached) foundAtTime = parseInt(cached, 10);
            }
            if (!foundAtTime) {
                foundAtTime = Date.now();
                localStorage.setItem(`ozon_found_at_${sessionId}`, String(foundAtTime));
            }
            currentFoundAtTimestamp = foundAtTime;
        }

        if (!currentFoundAtTimestamp) {
            timerEl.textContent = `⏱ 00:00`;
            return;
        }

        const elapsed = Math.max(0, Math.floor((Date.now() - currentFoundAtTimestamp) / 1000));
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        timerEl.textContent = `⏱ ${mins}:${secs}`;
    }

    // ================= ДИНАМИЧЕСКИЙ СЛОТ ОПЛАТЫ =================
    function updateStatusSlotUI() {
        const slotEl = document.getElementById('smart-status-slot');
        if (!slotEl) return;

        // 1. ЕСЛИ ВСЕ ОПЛАЧЕНО -> "✓ Оплачено"
        if (totalUnpaidDebt === 0) {
            slotEl.className = 'smart-panel-pay pay-clean';
            slotEl.innerHTML = `✓ Оплачено`;
            slotEl.title = "Все товары в заказе оплачены";
            slotEl.onclick = null;
            return;
        }

        // 2. ИЩЕМ, СКОЛЬКО УЖЕ ПИКНУТО ИЗ НЕОПЛАЧЕННЫХ
        let scannedUnpaidSum = 0;
        let hasScannedUnpaid = false;

        const cards = getAllCards();
        cards.forEach(card => {
            const isReady = card.querySelector('[data-testid="btnToGiveOut"]') ||
                            card.querySelector('[class*="_giveOut_"]') ||
                            card.querySelector('[class*="_success_"]') ||
                            (card.className && card.className.includes('_success_'));

            if (isReady && currentPostingsData) {
                const testId = card.getAttribute('data-testid') || '';
                const p = currentPostingsData.find(item =>
                    String(item.id) === testId ||
                    (item.barcodes && item.barcodes.includes(testId))
                );
                if (p && p.clientAmount > 0) {
                    scannedUnpaidSum += p.clientAmount;
                    hasScannedUnpaid = true;
                }
            }
        });

        // Запасная сверка с виджетом Озона
        if (!hasScannedUnpaid) {
            const nativeWidget = document.querySelector('[class*="_widgetList_"]');
            if (nativeWidget) {
                const match = nativeWidget.textContent.replace(/\s+/g, '').match(/(\d+(?:[.,]\d+)?)/);
                if (match) {
                    const parsed = parseFloat(match[1].replace(',', '.'));
                    if (parsed > 0) {
                        scannedUnpaidSum = parsed;
                        hasScannedUnpaid = true;
                    }
                }
            }
        }

        slotEl.className = 'pay-needed';

        // 3. ЕСЛИ УЖЕ ПИКНУТ ТОВАР -> "Сумма: 582/8330 ₽"
        if (hasScannedUnpaid && scannedUnpaidSum > 0) {
            slotEl.innerHTML = `<span class="pay-dot"></span>Сумма: ${scannedUnpaidSum}/${totalUnpaidDebt} ₽`;
            slotEl.title = `К списанию за выданные: ${scannedUnpaidSum} ₽ (Всего долг: ${totalUnpaidDebt} ₽)`;
        }
        // 4. ДО ПЕРВОГО ПИКНУТОГО -> "Сумма: 8330 ₽"
        else {
            slotEl.innerHTML = `<span class="pay-dot"></span>Сумма: ${totalUnpaidDebt} ₽`;
            slotEl.title = "Общий долг по заказу (товары еще не пикнуты)";
        }
    }

    function updateDynamicButtonsUI() {
        const count = getSelectedCards().length;

        const btnCheck = document.getElementById('smart-btn-check-all');
        const btnGiveout = document.getElementById('smart-btn-giveout-all');
        const btnRefuse = document.getElementById('smart-btn-refuse-all');
        const btnKeep = document.getElementById('smart-btn-keep-all');

        if (!btnCheck || !btnGiveout || !btnRefuse || !btnKeep) return;

        if (count > 0) {
            btnCheck.innerHTML = `${count} на проверку <span class="smart-keycap">RCtrl+1</span>`;
            btnGiveout.innerHTML = `${count} к выдаче <span class="smart-keycap">RCtrl+2</span>`;
            btnRefuse.innerHTML = `${count} в отказ <span class="smart-keycap">RCtrl+3</span>`;
            btnKeep.innerHTML = `${count} на хранение <span class="smart-keycap">RCtrl+4</span>`;
        } else {
            btnCheck.innerHTML = `Все на проверку <span class="smart-keycap">RCtrl+1</span>`;
            btnGiveout.innerHTML = `Все к выдаче <span class="smart-keycap">RCtrl+2</span>`;
            btnRefuse.innerHTML = `Все в отказ <span class="smart-keycap">RCtrl+3</span>`;
            btnKeep.innerHTML = `Все на хранение <span class="smart-keycap">RCtrl+4</span>`;
        }
    }

    function injectControlPanel() {
        if (!isSessionActive()) {
            const existing = document.getElementById('smart-control-panel');
            if (existing) existing.remove();
            return;
        }

        if (document.getElementById('smart-control-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'smart-control-panel';
        panel.innerHTML = `
            <div id="smart-session-timer" class="smart-panel-timer">⏱ 00:00</div>
            <div id="smart-status-slot" class="smart-focus-slot-btn inactive">🎯 Фокус: <b>ВЫКЛ</b></div>

            <button class="smart-panel-btn btn-check" id="smart-btn-check-all">
                Все на проверку <span class="smart-keycap">RCtrl+1</span>
            </button>
            <button class="smart-panel-btn btn-giveout" id="smart-btn-giveout-all">
                Все к выдаче <span class="smart-keycap">RCtrl+2</span>
            </button>
            <button class="smart-panel-btn btn-refuse" id="smart-btn-refuse-all">
                Все в отказ <span class="smart-keycap">RCtrl+3</span>
            </button>
            <button class="smart-panel-btn btn-keep" id="smart-btn-keep-all">
                Все на хранение <span class="smart-keycap">RCtrl+4</span>
            </button>

            <div style="position: relative;">
                <button class="smart-panel-btn btn-more" id="smart-btn-more">
                    Еще ▾
                </button>
                <div id="smart-more-dropdown">
                    <button class="smart-dropdown-item" id="smart-btn-select-similar">
                        Выделить однотипное <span class="smart-keycap">RCtrl+5</span>
                    </button>
                    <button class="smart-dropdown-item" id="smart-btn-select-all">
                        Выделить все <span class="smart-keycap">RCtrl+6</span>
                    </button>
                    <button class="smart-dropdown-item" id="smart-btn-deselect-all">
                        Снять все <span class="smart-keycap">RCtrl+7</span>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('smart-btn-check-all').onclick = () => massExecute('check');
        document.getElementById('smart-btn-giveout-all').onclick = () => massExecute('giveout');
        document.getElementById('smart-btn-refuse-all').onclick = () => massExecute('refuse');
        document.getElementById('smart-btn-keep-all').onclick = () => massExecute('keep');

        const moreBtn = document.getElementById('smart-btn-more');
        const dropdown = document.getElementById('smart-more-dropdown');

        moreBtn.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle('show'); };
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#smart-more-dropdown') && !e.target.closest('#smart-btn-more')) {
                dropdown.classList.remove('show');
            }
        });

        document.getElementById('smart-btn-select-similar').onclick = () => { selectSimilarCards(); dropdown.classList.remove('show'); };
        document.getElementById('smart-btn-select-all').onclick = () => { selectAllCards(true); dropdown.classList.remove('show'); };
        document.getElementById('smart-btn-deselect-all').onclick = () => { selectAllCards(false); dropdown.classList.remove('show'); };

        updateStatusSlotUI();
    }

    function isSimilarNames(s1, s2) {
        s1 = s1.toLowerCase().replace(/[^a-zа-я0-9]/gi, ' ').replace(/\s+/g, ' ').trim();
        s2 = s2.toLowerCase().replace(/[^a-zа-я0-9]/gi, ' ').replace(/\s+/g, ' ').trim();
        if (s1 === s2) return true;

        const len1 = s1.length, len2 = s2.length;
        if (Math.abs(len1 - len2) > 4) return false;

        const track = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));
        for (let i = 0; i <= len1; i++) track[0][i] = i;
        for (let j = 0; j <= len2; j++) track[j][0] = j;

        for (let j = 1; j <= len2; j++) {
            for (let i = 1; i <= len1; i++) {
                const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
                track[j][i] = Math.min(track[j][i - 1] + 1, track[j - 1][i] + 1, track[j - 1][i - 1] + indicator);
            }
        }
        const dist = track[len2][len1];
        return dist <= 3 || (dist / Math.max(len1, len2) < 0.15);
    }

    function selectSimilarCards() {
        const target = getTargetItem();
        if (!target) return;
        const targetTitleEl = target.querySelector('[data-testid="postingName"], [class*="_name_"]');
        const targetTitle = targetTitleEl ? targetTitleEl.textContent.trim() : '';
        if (!targetTitle) return;

        getAllCards().forEach(card => {
            const nameEl = card.querySelector('[data-testid="postingName"], [class*="_name_"]');
            if (nameEl && isSimilarNames(targetTitle, nameEl.textContent.trim())) {
                card.classList.add('smart-control-selected');
            }
        });
    }

    function toggleFocusMode() {
        isFocusMode = !isFocusMode;
        document.body.classList.toggle('smart-focus-active', isFocusMode);
        updateStatusSlotUI();
    }

    // ================= ПРОВЕРКА ЭКЗЕМПЛЯРОВ (БЛОКИРОВКА НА 10 СЕК) =================
    function checkExemplarButtons() {
        const checkButtons = document.querySelectorAll('[data-testid="btnToCheck"]');

        checkButtons.forEach(btn => {
            const card = btn.closest('[class*="_card_"]');
            if (!card || card.dataset.smartExemplarLocked) return;

            // Ищем паттерн точки "•" и числа в кнопке (например "Проверить • 7 товаров")
            const text = btn.textContent;
            const match = text.match(/•\s*(\d+)/);

            if (match) {
                const count = match[1];
                card.dataset.smartExemplarLocked = "active"; // Блокируем повторный запуск

                // 1. Показываем всплывающее предупреждение
                playAnnulateAlert();
                alert(`⚠️ ВНИМАНИЕ: В позиции несколько экземпляров (${count} шт)!\n\nУбедитесь, что выдаете клиенту ровно ${count} шт физически!`);

                // 2. Блокируем кнопку на 10 секунд и запускаем уменьшающуюся полосу
                let timeLeft = 10;
                btn.classList.add('smart-btn-countdown-locked');
                const originalHtml = btn.innerHTML;

                const bar = document.createElement('div');
                bar.className = 'smart-btn-countdown-bar';
                btn.appendChild(bar);

                const countdownInterval = setInterval(() => {
                    timeLeft--;
                    bar.style.width = `${(timeLeft / 10) * 100}%`;

                    const labelEl = btn.querySelector('[class*="_text_"]') || btn;
                    labelEl.textContent = `Проверка через: ${timeLeft} сек`;

                    if (timeLeft <= 0) {
                        clearInterval(countdownInterval);
                        btn.classList.remove('smart-btn-countdown-locked');
                        btn.innerHTML = originalHtml; // Возвращаем исходный вид
                        card.dataset.smartExemplarLocked = "done";
                    }
                }, 1000);
            }
        });
    }

    function getAllCards() {
        const wrappers = Array.from(document.querySelectorAll('[data-testid="postingContentWrapper"]'));
        if (wrappers.length > 0) {
            return wrappers.map(w => w.closest('[class*="_card_"]')).filter(Boolean);
        }
        return Array.from(document.querySelectorAll('[class*="_card_"]:not([class*="Inner"])'));
    }

    function getSelectedCards() { return Array.from(document.querySelectorAll('.smart-control-selected')); }
    function selectAllCards(select = true) {
        getAllCards().forEach(c => {
            if (select) c.classList.add('smart-control-selected');
            else c.classList.remove('smart-control-selected');
        });
    }

    async function triggerCardSplitAction(card, actionType) {
        if (actionType === 'giveout') {
            const btn = card.querySelector('[data-testid="btnToGiveOut"]');
            if (btn) { simulateRealClick(btn); return; }
        } else if (actionType === 'keep') {
            const btn = card.querySelector('[data-testid="btnToKeep"]');
            if (btn) { simulateRealClick(btn); return; }
        } else if (actionType === 'refuse') {
            const btn = card.querySelector('[data-testid="btnToAnnulate"]');
            if (btn) { simulateRealClick(btn); return; }
        }

        const splitBtns = card.querySelectorAll('[class*="splitButton"] button');
        let arrowBtn = splitBtns.length >= 2 ? splitBtns[splitBtns.length - 1] : null;
        if (!arrowBtn) arrowBtn = Array.from(card.querySelectorAll('button:not([class*="smart-"])')).find(b => b.querySelector('svg') && !b.textContent.trim());

        if (!arrowBtn) return;
        simulateRealClick(arrowBtn);

        let attempts = 0;
        await new Promise(resolve => {
            const iv = setInterval(() => {
                attempts++;
                const menuItems = document.querySelectorAll('[role="menuitem"], [class*="DropDownItem"], [data-testid*="DropDownItem"]');
                if (menuItems.length > 0) {
                    clearInterval(iv);
                    let targetItem = null;
                    menuItems.forEach(item => {
                        const txt = item.textContent.toLowerCase();
                        if (actionType === 'giveout' && txt.includes('выдач')) targetItem = item;
                        else if (actionType === 'keep' && txt.includes('хранен')) targetItem = item;
                        else if (actionType === 'refuse' && (txt.includes('отказ') || txt.includes('решен') || txt.includes('клиент'))) targetItem = item;
                    });
                    if (targetItem) simulateRealClick(targetItem.closest('button') || targetItem);
                    resolve();
                } else if (attempts > 12) {
                    clearInterval(iv);
                    resolve();
                }
            }, 80);
        });
    }

    async function massExecute(actionType) {
        let targets = getSelectedCards();
        if (targets.length === 0) targets = getAllCards();

        for (let card of targets) {
            if (actionType === 'check') {
                const isAnnulated = card.querySelector('[data-testid="btnToAnnulate"], [class*="_annulation_"]');
                if (isAnnulated) continue;
                const btn = card.querySelector('[data-testid="btnToCheck"]');
                if (btn) simulateRealClick(btn);
            } else {
                await triggerCardSplitAction(card, actionType);
            }
            await new Promise(r => setTimeout(r, 70));
        }
    }

    window.addEventListener('keydown', function(e) {
        // РАБОТАЕТ ВЕЗДЕ НА СТРАНИЦЕ ЗАКАЗОВ (как в v7.9)
        if (!isOrdersPage()) return;

        // ДВОЙНОЙ RCTRL (ФОКУС-МОД)
        if (e.code === 'ControlRight' || (e.ctrlKey && e.location === 2)) {
            isRightCtrlHeld = true;
            rCtrlPresses++;
            if (rCtrlPresses === 1) {
                rCtrlTimer = setTimeout(() => { rCtrlPresses = 0; }, 350);
            } else if (rCtrlPresses === 2) {
                clearTimeout(rCtrlTimer);
                rCtrlPresses = 0;
                toggleFocusMode();
            }
        }

        // ВЫДЕЛЕНИЕ НА ПРОБЕЛ
        if (e.code === 'Space') {
            if (isInputActive()) return;
            e.preventDefault();
            e.stopPropagation();
            const target = getTargetItem();
            if (target) target.classList.toggle('smart-control-selected');
            return;
        }

        // БИНДЫ RCTRL + 1..7
        if (isRightCtrlHeld || (e.ctrlKey && e.location === 2)) {
            if (e.code === 'Digit1' || e.code === 'Numpad1') { e.preventDefault(); e.stopPropagation(); massExecute('check'); }
            else if (e.code === 'Digit2' || e.code === 'Numpad2') { e.preventDefault(); e.stopPropagation(); massExecute('giveout'); }
            else if (e.code === 'Digit3' || e.code === 'Numpad3') { e.preventDefault(); e.stopPropagation(); massExecute('refuse'); }
            else if (e.code === 'Digit4' || e.code === 'Numpad4') { e.preventDefault(); e.stopPropagation(); massExecute('keep'); }
            else if (e.code === 'Digit5' || e.code === 'Numpad5') { e.preventDefault(); e.stopPropagation(); selectSimilarCards(); }
            else if (e.code === 'Digit6' || e.code === 'Numpad6') { e.preventDefault(); e.stopPropagation(); selectAllCards(true); }
            else if (e.code === 'Digit7' || e.code === 'Numpad7') { e.preventDefault(); e.stopPropagation(); selectAllCards(false); }
        }

        // СТРЕЛКИ
        if (!isInputActive() && !isRightCtrlHeld && e.code !== 'Space') {
            if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
                e.preventDefault(); navigateCards('down'); return;
            }
            if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
                e.preventDefault(); navigateCards('up'); return;
            }
        }

        const now = Date.now();
        if (now - lastScanKeyTime > 400) scanBuffer = '';
        lastScanKeyTime = now;

        if (e.isTrusted && !audioCtx) initAudio();

        if (e.key === 'Escape') {
            const backSvgPath = document.querySelector('path[d^="M6.293 2.293"]');
            if (backSvgPath) {
                const backBtn = backSvgPath.closest('button');
                if (backBtn) { e.preventDefault(); e.stopPropagation(); simulateRealClick(backBtn); }
            }
            return;
        }

        if (e.key === 'Enter' && e.code !== KEY_ENTER) {
            const barcode = scanBuffer.trim();
            scanBuffer = '';
            if (barcode.length >= 5) handleBarcodeScan(barcode);
            return;
        }

        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const mappedChar = RUS_TO_ENG[e.key] || e.key;
            scanBuffer += mappedChar;
        }

        if (isInputActive() && e.code !== KEY_ENTER) return;

        if (e.code === KEY_MULTIPLY) {
            e.preventDefault(); e.stopPropagation();
            activePackageIndex = activePackageIndex === 0 ? 1 : 0;
            highlightActivePackage();
            return;
        }

        if (e.code === KEY_ADD || e.code === KEY_SUBTRACT) {
            e.preventDefault(); e.stopPropagation();
            adjustPackage(e.code === KEY_ADD ? 'increment' : 'decrement');
            return;
        }

        if (e.code === KEY_CHECK) {
            e.preventDefault(); e.stopPropagation();
            numpad0Presses++;
            if (numpad0Presses === 1) {
                numpad0Timer = setTimeout(() => { numpad0Presses = 0; }, 400);
            } else if (numpad0Presses === 2) {
                clearTimeout(numpad0Timer);
                numpad0Presses = 0;
                triggerBtnToCheck();
            }
            return;
        }

        if (REASON_KEYS.includes(e.code)) {
            e.preventDefault(); e.stopPropagation();
            const requestedNum = REASON_KEYS.indexOf(e.code) + 1;
            numpadReasonPresses[e.code] = (numpadReasonPresses[e.code] || 0) + 1;

            if (numpadReasonPresses[e.code] === 1) {
                numpadReasonTimers[e.code] = setTimeout(() => { numpadReasonPresses[e.code] = 0; }, 400);
            } else if (numpadReasonPresses[e.code] === 2) {
                clearTimeout(numpadReasonTimers[e.code]);
                numpadReasonPresses[e.code] = 0;

                const target = getTargetItem();
                if (target) {
                    const success = openDropdownAndSelect(target, requestedNum);
                    if (success) enterBlockUntil = Date.now() + 2000;
                }
            }
            return;
        }

        if (e.code === KEY_ENTER) {
            e.preventDefault(); e.stopPropagation();
            if (isEnterHolding || enterCompleted) return; // Игнорируем автоповтор клавиатуры

            const mainBtn = findMainActionButton();
            if (!mainBtn) return;

            if (Date.now() < enterBlockUntil) {
                playAnnulateAlert();
                mainBtn.style.transition = 'background-color 0.1s';
                mainBtn.style.backgroundColor = '#ff4d4f';
                setTimeout(() => mainBtn.style.backgroundColor = '', 200);
                return;
            }

            const btnText = mainBtn.textContent.trim();
            const isPaymentOrRetry = btnText.includes('Провести оплату') || btnText.includes('Попробовать ещё') || btnText.includes('Оплатить');

            if (isPaymentOrRetry) {
                isEnterHolding = true;
                heldButton = mainBtn;
                heldButton.classList.add('smart-btn-progress');
                heldButton.classList.remove('done');
                void heldButton.offsetWidth;
                heldButton.style.setProperty('--smart-progress', '100%');

                enterHoldTimeout = setTimeout(() => {
                    heldButton.classList.add('done');
                    simulateRealClick(heldButton);
                    isEnterHolding = false;
                    enterCompleted = true; // Блокируем новые нажатия, пока Enter не отпустят руками
                    heldButton = null;
                }, 400);
            } else {
                enterCompleted = true;
                simulateRealClick(mainBtn);
            }
        }
    }, true);

    window.addEventListener('keyup', function(e) {
        if (!isOrdersPage()) return;
        if (e.code === 'ControlRight' || e.location === 2) isRightCtrlHeld = false;

        if (e.code === KEY_ENTER) {
            enterCompleted = false; // Сбрасываем флаг, когда физически отпустили клавишу
            if (isEnterHolding) {
                clearTimeout(enterHoldTimeout);
                if (heldButton) heldButton.style.setProperty('--smart-progress', '0%');
                isEnterHolding = false;
                heldButton = null;
            }
        }
    }, true);

    window.addEventListener('mousedown', function(e) {
        if (!isOrdersPage()) return;
        if (e.button !== 0) return;
        if (e.target.closest('button, input, textarea, a, svg, #smart-control-panel, #smart-more-dropdown')) return;

        isMouseDown = true;
        isDraggingSelection = false;
        document.body.classList.add('smart-no-select');
    }, true);

    window.addEventListener('mousemove', function(e) {
        if (!isMouseDown) return;
        const card = e.target.closest('[class*="_card_"]');
        if (card) {
            isDraggingSelection = true;
            card.classList.add('smart-control-selected');
        }
    }, true);

    window.addEventListener('mouseup', function(e) {
        document.body.classList.remove('smart-no-select');
        if (!isOrdersPage()) return;

        if (isMouseDown && !isDraggingSelection && e.button === 0) {
            if (!e.target.closest('button, input, textarea, a, svg, #smart-control-panel, #smart-more-dropdown')) {
                const card = e.target.closest('[class*="_card_"]');
                if (card) card.classList.toggle('smart-control-selected');
            }
        }
        isMouseDown = false;
        setTimeout(() => { isDraggingSelection = false; }, 50);
    }, true);

    function navigateCards(direction) {
        const cards = getAllCards();
        if (cards.length === 0) return;

        let currentIndex = cards.indexOf(getTargetItem());
        if (currentIndex === -1) currentIndex = 0;

        if (direction === 'down' || direction === 'right') {
            currentIndex = (currentIndex + 1) % cards.length;
        } else if (direction === 'up' || direction === 'left') {
            currentIndex = (currentIndex - 1 + cards.length) % cards.length;
        }

        const newTarget = cards[currentIndex];
        lastSuccessCard = newTarget;

        const ta = newTarget.querySelector('textarea[aria-hidden="true"], input[type="text"]');
        if (ta) activeBarcode = ta.value || ta.getAttribute('value') || ta.textContent;

        maintainFocusVisual();
        newTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    setInterval(() => {
        if (!isOrdersPage()) {
            const p = document.getElementById('smart-control-panel');
            if (p) p.remove();
            return;
        }
        highlightActivePackage();
        injectReasonNumbers();
        maintainFocusVisual();
        injectControlPanel();
        updateSessionTimerUI();
        updateStatusSlotUI();
        updateDynamicButtonsUI();
        checkExemplarButtons();
        fixKgtShelves();
    }, 200);

    function adjustPackage(action) {
        const counters = document.querySelectorAll('[class*="input-count__group"]');
        if (counters.length <= activePackageIndex) return;
        const buttonClass = action === 'increment' ? '[class*="increment"]' : '[class*="decrement"]';
        const btn = counters[activePackageIndex].querySelector(buttonClass);
        if (btn && !btn.disabled) simulateRealClick(btn);
    }

    // Надежный поиск главной кнопки действия (с поддержкой Провести оплату и любых сумм)
    function findMainActionButton() {
        // Приоритеты как в v7.9: модалки -> Выдать -> Оплата -> Аннуляция
        const priorities = ['Подтвердить', 'Попробовать ещё', 'Повторить', 'Выдать', 'Продолжить', 'Провести оплату', 'Оплатить', 'Аннулировать', 'На главную'];
        const allButtons = Array.from(document.querySelectorAll('button:not([class*="smart-"])'));

        for (let text of priorities) {
            const btn = allButtons.find(b => {
                if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
                const t = b.textContent.trim();
                return t === text || t.startsWith(text);
            });
            if (btn) return btn;
        }

        const fallback = document.querySelector('[data-testid="giveOutActionButton"]');
        return (fallback && !fallback.disabled && fallback.getAttribute('aria-disabled') !== 'true') ? fallback : null;
    }

    function handleBarcodeScan(barcode) {
        const now = Date.now();
        activeBarcode = barcode;
        if (CIS_PATTERN.test(barcode)) console.log(`[Smart Control] Распознан КИЗ: ${barcode}.`);
        const item = getTargetItem();
        if (barcode === lastScannedBarcode && (now - lastScanTime) < 1500) {
            if (item) {
                item.style.outline = '3px solid #ff4d4f';
                setTimeout(() => { if (item) item.style.outline = 'none'; }, 500);
            }
            const success = openDropdownAndSelect(item, 'DOUBLE_SCAN');
            if (success) enterBlockUntil = Date.now() + 2000;
            lastScannedBarcode = '';
        } else {
            lastScannedBarcode = barcode;
            lastScanTime = now;
        }
    }

    function triggerBtnToCheck() {
        const targetItem = getTargetItem();
        if (!targetItem) return;
        const isAnnulated = targetItem.querySelector('[data-testid="btnToAnnulate"], [class*="_annulation_"]');
        if (isAnnulated) return;
        const btn = targetItem.querySelector('[data-testid="btnToCheck"]');
        if (btn) simulateRealClick(btn);
    }

    function openDropdownAndSelect(targetItem, requestedNumOrDoubleScan) {
        if (!targetItem) return false;
        const isDoubleScan = requestedNumOrDoubleScan === 'DOUBLE_SCAN';
        const requestedNum = typeof requestedNumOrDoubleScan === 'number' ? requestedNumOrDoubleScan : null;

        const selectFromOpenMenu = () => {
            let targetOption = null;
            if (!isDoubleScan) {
                const badge = document.querySelector(`.numpad-badge-helper[data-reason-num="${requestedNum}"]`);
                if (badge) targetOption = badge.closest('[data-testid^="postingDropDownItemToAnnulate"]');
                else {
                    const options = Array.from(document.querySelectorAll('[data-testid^="postingDropDownItemToAnnulate"]'));
                    if (options[requestedNum - 1]) targetOption = options[requestedNum - 1];
                }
            }
            if (targetOption) simulateRealClick(targetOption.closest('button') || targetOption.closest('[role="menuitem"]') || targetOption);
        };

        if (document.querySelectorAll('[data-testid^="postingDropDownItemToAnnulate"]').length > 0) {
            injectReasonNumbers();
            selectFromOpenMenu();
            return true;
        }

        let arrowBtn = null;
        const splitBtns = targetItem.querySelectorAll('[class*="splitButton"] button');
        if (splitBtns.length >= 2) arrowBtn = splitBtns[splitBtns.length - 1];
        else {
            arrowBtn = Array.from(targetItem.querySelectorAll('button:not([class*="smart-"])')).find(b => b.querySelector('svg') && !b.textContent.trim() && !b.getAttribute('data-testid')?.match(/btnTo(Check|GiveOut|Annulate|Keep)/i));
        }

        if (!arrowBtn) return false;
        simulateRealClick(arrowBtn);

        let attempts = 0;
        const checkDropdown = setInterval(() => {
            attempts++;
            if (document.querySelectorAll('[data-testid^="postingDropDownItemToAnnulate"]').length > 0) {
                clearInterval(checkDropdown);
                injectReasonNumbers();
                selectFromOpenMenu();
            } else if (attempts > 15) {
                clearInterval(checkDropdown);
            }
        }, 100);

        return true;
    }

    function injectReasonNumbers() {
        const dropdownItems = document.querySelectorAll('[data-testid^="postingDropDownItemToAnnulate"]');
        if (dropdownItems.length === 0) return;

        const usedNums = new Set();
        dropdownItems.forEach(item => {
            const labelContainer = item.querySelector('[class*="data-content__label"]') || item;
            const existingBadge = labelContainer.querySelector('.numpad-badge-helper');
            if (existingBadge) {
                usedNums.add(parseInt(existingBadge.dataset.reasonNum, 10));
                return;
            }

            let text = labelContainer.textContent.toLowerCase();
            let num = null;
            if (text.includes('брак') || text.includes('поврежд') || text.includes('разбит') || text.includes('дефект')) num = 1;
            else if (text.includes('ошиб') || text.includes('не тот') || text.includes('подмен') || text.includes('пересорт')) num = 2;
            else if (text.includes('неполн') || text.includes('пуст') || text.includes('част') || text.includes('вскрыт')) num = 3;
            else if (text.includes('решени') || text.includes('отказ') || text.includes('клиент') || text.includes('передумал')) num = 4;
            else if (text.includes('срок') || text.includes('просроч') || text.includes('проч') || text.includes('опозд')) num = 5;

            if (num) { item.dataset.fixedNum = num; usedNums.add(num); }
        });

        dropdownItems.forEach(item => {
            const labelContainer = item.querySelector('[class*="data-content__label"]') || item;
            if (labelContainer.querySelector('.numpad-badge-helper')) return;

            let num = item.dataset.fixedNum;
            if (!num) {
                for (let i = 1; i <= 9; i++) {
                    if (!usedNums.has(i)) { num = i; usedNums.add(i); break; }
                }
            }

            if (num) {
                const badge = document.createElement('span');
                badge.className = 'numpad-badge-helper';
                badge.dataset.reasonNum = num;
                badge.style.marginLeft = '12px';
                badge.style.padding = '2px 6px';
                badge.style.background = '#e4e6e9';
                badge.style.color = '#4e5b6c';
                badge.style.border = '1px solid #cbced4';
                badge.style.borderRadius = '4px';
                badge.style.fontSize = '11px';
                badge.style.fontWeight = 'bold';
                badge.style.fontFamily = 'monospace';
                badge.style.display = 'inline-block';
                badge.style.boxShadow = '0 1px 0 rgba(0,0,0,0.15)';
                badge.textContent = `[Num ${num}]`;
                labelContainer.appendChild(badge);
            }
        });
    }

    function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    function playAnnulateAlert() {
        initAudio();
        const t = audioCtx.currentTime;
        const playNote = (start, freq) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, start);
            osc.frequency.exponentialRampToValueAtTime(freq / 2, start + 0.2);
            gain.gain.setValueAtTime(3.0, start);
            gain.gain.exponentialRampToValueAtTime(0.01, start + 0.2);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(start);
            osc.stop(start + 0.2);
        };
        playNote(t, 400); playNote(t, 420);
        playNote(t + 0.15, 300); playNote(t + 0.15, 315);
    }

    function isInputActive() {
        const el = document.activeElement;
        return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }

    function findItemByBarcode(barcode) {
        if (!barcode) return null;
        const lowerBarcode = barcode.trim().toLowerCase();
        const textareas = document.querySelectorAll('textarea[aria-hidden="true"], input[type="text"], input[type="hidden"]');
        for (let el of textareas) {
            const val = el.value || el.getAttribute('value') || el.textContent;
            if (val && val.trim().toLowerCase() === lowerBarcode) {
                return el.closest('[class*="_card_"], [class*="_item_"]') || el.parentElement;
            }
        }
        const direct = document.querySelector(`[data-testid*="${barcode}"]`);
        return direct ? (direct.closest('[class*="_card_"], [class*="_item_"]') || direct) : null;
    }

    function getTargetItem() {
        let item = null;
        if (activeBarcode) item = findItemByBarcode(activeBarcode);
        if (!item && lastSuccessCard && document.body.contains(lastSuccessCard)) item = lastSuccessCard;
        if (!item) {
            const successCards = document.querySelectorAll('[class*="_success_"]');
            if (successCards.length > 0) item = successCards[successCards.length - 1].closest('[class*="_card_"]');
        }
        if (!item) {
            const anyBtn = document.querySelector('[data-testid="btnToCheck"], [data-testid="btnToGiveOut"]');
            if (anyBtn) item = anyBtn.closest('[class*="_card_"]');
        }
        return item;
    }

    function highlightActivePackage() {
        const counters = document.querySelectorAll('[class*="input-count__group"]');
        counters.forEach((counter, idx) => {
            if (idx === activePackageIndex) {
                counter.style.outline = '3px solid #005bff';
                counter.style.outlineOffset = '2px';
                counter.style.borderRadius = '4px';
                counter.style.boxShadow = '0 0 8px rgba(0, 91, 255, 0.5)';
            } else {
                counter.style.outline = 'none';
                counter.style.boxShadow = 'none';
            }
        });
    }

    function maintainFocusVisual() {
        document.querySelectorAll('.smart-control-focus').forEach(el => el.classList.remove('smart-control-focus'));
        const target = getTargetItem();
        if (target) target.classList.add('smart-control-focus');
    }

    function simulateRealClick(element) {
        if (!element) return;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
            const ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 });
            element.dispatchEvent(ev);
        });
    }
})();
