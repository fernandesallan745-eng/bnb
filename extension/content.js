// Handsfree Chrome Extension - Content Script (Injected on any webpage)
(function () {
  if (window.__HANDSFREE_INJECTED__) return;
  window.__HANDSFREE_INJECTED__ = true;

  let state = {
    enabled: false,
    mode: "hybrid",
    dwellTimeMs: 1200,
    sensitivity: 1.4,
    showNumbers: false,
    soundFeedback: true,
  };

  // Cursor & Dwell Tracking State
  let cursorX = window.innerWidth / 2;
  let cursorY = window.innerHeight / 2;
  let targetX = cursorX;
  let targetY = cursorY;
  let isDwelling = false;
  let dwellStartTime = 0;
  let dwellAnchorX = 0;
  let dwellAnchorY = 0;
  const DWELL_RADIUS = 30; // Radius tolerance in pixels
  let lastClickTime = 0;
  let animFrameId = null;

  // Numbered Badges Map
  let badgesMap = new Map(); // number -> element

  // Elements
  let cursorContainer = null;
  let cursorEl = null;
  let dwellMeterEl = null;
  let hudEl = null;
  let toastEl = null;

  // Initialize Audio Context for Click Feedback
  let audioCtx = null;
  function playClickSound() {
    if (!state.soundFeedback) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.06);
    } catch {
      // Audio autoplay policy
    }
  }

  // Build Cursor & Overlay DOM
  function createOverlay() {
    if (document.getElementById("handsfree-cursor-container")) return;

    cursorContainer = document.createElement("div");
    cursorContainer.id = "handsfree-cursor-container";

    cursorEl = document.createElement("div");
    cursorEl.id = "handsfree-cursor";
    cursorEl.innerHTML = `
      <svg class="handsfree-dwell-svg" viewBox="0 0 36 36">
        <circle class="handsfree-dwell-bg" cx="18" cy="18" r="14"></circle>
        <circle class="handsfree-dwell-meter" cx="18" cy="18" r="14" pathLength="100"></circle>
      </svg>
      <div class="handsfree-cursor-dot"></div>
    `;

    dwellMeterEl = cursorEl.querySelector(".handsfree-dwell-meter");
    cursorContainer.appendChild(cursorEl);
    document.body.appendChild(cursorContainer);

    // Floating HUD
    hudEl = document.createElement("div");
    hudEl.id = "handsfree-floating-hud";
    hudEl.innerHTML = `
      <div class="handsfree-hud-indicator"></div>
      <span class="handsfree-hud-title">Handsfree</span>
      <span class="handsfree-hud-tag" id="handsfree-hud-mode">${state.mode}</span>
      <button type="button" class="handsfree-hud-btn" id="handsfree-hud-numbers-btn">Numbers</button>
      <button type="button" class="handsfree-hud-btn" id="handsfree-hud-pause-btn">Pause</button>
    `;
    document.body.appendChild(hudEl);

    // Toast
    toastEl = document.createElement("div");
    toastEl.id = "handsfree-toast";
    document.body.appendChild(toastEl);

    // HUD Button events
    hudEl.querySelector("#handsfree-hud-numbers-btn")?.addEventListener("click", () => {
      toggleNumberedBadges();
    });

    hudEl.querySelector("#handsfree-hud-pause-btn")?.addEventListener("click", () => {
      toggleHandsfree();
    });

    updateVisibility();
  }

  function updateVisibility() {
    if (!cursorContainer || !hudEl) return;
    if (state.enabled) {
      cursorContainer.style.display = "block";
      hudEl.style.display = "flex";
      startAnimationLoop();
    } else {
      cursorContainer.style.display = "none";
      hudEl.style.display = "none";
      removeNumberedBadges();
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    }
  }

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2200);
  }

  // Animation Loop (Lerp smoothing & Dwell checking)
  function startAnimationLoop() {
    if (animFrameId) return;

    function loop() {
      if (!state.enabled) return;

      // Smooth interpolation (lerp)
      const lerpFactor = 0.22;
      cursorX += (targetX - cursorX) * lerpFactor;
      cursorY += (targetY - cursorY) * lerpFactor;

      if (cursorEl) {
        cursorEl.style.left = `${cursorX}px`;
        cursorEl.style.top = `${cursorY}px`;
      }

      // Handle Dwell Selection
      checkDwell();

      animFrameId = requestAnimationFrame(loop);
    }

    animFrameId = requestAnimationFrame(loop);
  }

  function checkDwell() {
    const now = performance.now();
    const dist = Math.hypot(cursorX - dwellAnchorX, cursorY - dwellAnchorY);

    if (dist > DWELL_RADIUS) {
      // Movement detected, reset dwell anchor
      dwellAnchorX = cursorX;
      dwellAnchorY = cursorY;
      dwellStartTime = now;
      isDwelling = false;
      if (cursorEl) cursorEl.classList.remove("dwelling");
      if (dwellMeterEl) dwellMeterEl.style.strokeDashoffset = "100";
      return;
    }

    // Cursor is stationary within dwell radius
    const elapsed = now - dwellStartTime;
    const progress = Math.min(1, elapsed / state.dwellTimeMs);

    if (dwellMeterEl) {
      dwellMeterEl.style.strokeDashoffset = `${100 - progress * 100}`;
    }

    if (progress > 0.15 && !isDwelling) {
      isDwelling = true;
      if (cursorEl) cursorEl.classList.add("dwelling");
    }

    // Trigger Click when dwell completes
    if (progress >= 1.0 && now - lastClickTime > 600) {
      lastClickTime = now;
      dwellStartTime = now + 400; // Reset dwell timer with brief pause
      triggerClickAt(cursorX, cursorY);
    }
  }

  // Find Clickable Element & Dispatch Real DOM Events
  function triggerClickAt(x, y) {
    playClickSound();

    // Spawn ripple
    if (cursorContainer) {
      const ripple = document.createElement("div");
      ripple.className = "handsfree-click-ripple";
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      cursorContainer.appendChild(ripple);
      setTimeout(() => ripple.remove(), 450);
    }

    // Temporarily hide cursor to find underlying element
    cursorContainer.style.pointerEvents = "none";
    let target = document.elementFromPoint(x, y);

    if (!target) return;

    // Traverse upwards to find nearest interactive element
    const interactive = target.closest("a, button, input, textarea, select, [role='button'], [tabindex='0']");
    if (interactive) {
      target = interactive;
    }

    const mouseOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    };

    target.dispatchEvent(new PointerEvent("pointerdown", mouseOpts));
    target.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
    target.dispatchEvent(new PointerEvent("pointerup", mouseOpts));
    target.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
    target.click();

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.focus();
    }
  }

  // Voice Typing into Inputs
  function typeTextIntoInput(text) {
    // 1. Try currently focused element
    let el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable)) {
      // 2. Try element under cursor
      const under = document.elementFromPoint(cursorX, cursorY);
      el = under?.closest("input, textarea, [contenteditable]") || null;
    }
    // 3. Try standard search bar (Google textarea[name="q"], input[type="search"], etc.)
    if (!el) {
      el = document.querySelector('textarea[name="q"], input[name="q"], input[type="search"], input[type="text"]');
    }

    if (el) {
      el.focus();
      if (el.isContentEditable) {
        document.execCommand("insertText", false, text);
      } else {
        const val = el.value ? `${el.value} ${text}` : text;
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      showToast(`Typed: "${text}"`);
    } else {
      showToast("No text field found to type into");
    }
  }

  // Numbered Badges (Voice Tagging)
  function toggleNumberedBadges() {
    if (badgesMap.size > 0) {
      removeNumberedBadges();
      showToast("Numbers hidden");
    } else {
      generateNumberedBadges();
      showToast("Numbered tags visible. Say 'click [number]'");
    }
  }

  function removeNumberedBadges() {
    document.querySelectorAll(".handsfree-number-badge").forEach((el) => el.remove());
    badgesMap.clear();
  }

  function generateNumberedBadges() {
    removeNumberedBadges();

    const selector = "a[href], button, input, textarea, select, [role='button'], [tabindex='0']";
    const candidates = Array.from(document.querySelectorAll(selector));

    let index = 1;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      // Only badge visible elements in current viewport
      if (
        rect.width > 8 &&
        rect.height > 8 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth &&
        window.getComputedStyle(el).visibility !== "hidden" &&
        window.getComputedStyle(el).display !== "none"
      ) {
        const badge = document.createElement("div");
        badge.className = "handsfree-number-badge";
        badge.textContent = `${index}`;
        badge.style.left = `${rect.left + window.scrollX}px`;
        badge.style.top = `${rect.top + window.scrollY}px`;
        document.body.appendChild(badge);

        badgesMap.set(index, el);
        index++;
        if (index > 99) break; // cap at 99 for high performance
      }
    }
  }

  function clickBadgeNumber(num) {
    const el = badgesMap.get(num);
    if (el) {
      const rect = el.getBoundingClientRect();
      targetX = rect.left + rect.width / 2;
      targetY = rect.top + rect.height / 2;
      cursorX = targetX;
      cursorY = targetY;
      triggerClickAt(targetX, targetY);
      showToast(`Clicked #${num}`);
      // Refresh badges after navigation
      setTimeout(() => generateNumberedBadges(), 500);
    } else {
      showToast(`Number #${num} not found`);
    }
  }

  // Voice Scrolling
  function performScroll(direction, amount = 400) {
    if (direction === "down") {
      window.scrollBy({ top: amount, behavior: "smooth" });
    } else if (direction === "up") {
      window.scrollBy({ top: -amount, behavior: "smooth" });
    } else if (direction === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (direction === "bottom") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
    // Update badge positions if active
    if (badgesMap.size > 0) {
      setTimeout(() => generateNumberedBadges(), 350);
    }
  }

  function toggleHandsfree() {
    chrome.runtime.sendMessage({ type: "TOGGLE_HANDSFREE" }, (res) => {
      if (res?.state) {
        state = res.state;
        updateVisibility();
        showToast(state.enabled ? "Handsfree Activated" : "Handsfree Paused");
      }
    });
  }

  // Listen for Messages from Extension Background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "HANDSFREE_STATE_CHANGED") {
      state = { ...state, ...msg.state };
      if (hudEl) {
        const modeEl = hudEl.querySelector("#handsfree-hud-mode");
        if (modeEl) modeEl.textContent = state.mode;
      }
      updateVisibility();
    }

    if (msg.type === "HANDSFREE_CURSOR_UPDATE") {
      // payload: { x: 0..1, y: 0..1, source: 'head'|'hand' }
      if (!state.enabled) return;
      const rawX = msg.payload.x * window.innerWidth;
      const rawY = msg.payload.y * window.innerHeight;
      targetX = Math.max(10, Math.min(window.innerWidth - 10, rawX));
      targetY = Math.max(10, Math.min(window.innerHeight - 10, rawY));
    }

    if (msg.type === "HANDSFREE_ACTION") {
      if (!state.enabled) return;
      const { action, payload } = msg;

      switch (action) {
        case "CLICK":
          triggerClickAt(cursorX, cursorY);
          break;
        case "CLICK_NUMBER":
          clickBadgeNumber(payload);
          break;
        case "TYPE":
          typeTextIntoInput(payload);
          break;
        case "SEARCH":
          typeTextIntoInput(payload);
          // Try submitting search
          setTimeout(() => {
            const form = document.querySelector("form");
            form?.dispatchEvent(new Event("submit", { bubbles: true }));
          }, 300);
          break;
        case "SCROLL":
          performScroll(payload.direction, payload.amount);
          break;
        case "SHOW_NUMBERS":
          generateNumberedBadges();
          break;
        case "HIDE_NUMBERS":
          removeNumberedBadges();
          break;
        case "NAV_BACK":
          window.history.back();
          break;
        case "NAV_FORWARD":
          window.history.forward();
          break;
        case "NAV_RELOAD":
          window.location.reload();
          break;
        case "TOAST":
          showToast(payload);
          break;
      }
    }
  });

  // Hotkeys: Alt+Shift+H to toggle Handsfree
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyH") {
      e.preventDefault();
      toggleHandsfree();
    }
    if (e.code === "Escape" && state.enabled) {
      toggleHandsfree();
    }
  });

  // Query Initial State
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
    if (res?.state) {
      state = { ...state, ...res.state };
    }
    createOverlay();
  });
})();
