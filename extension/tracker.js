// Handsfree Chrome Extension - Companion Tracker Engine
(function () {
  const video = document.getElementById("tracker-video");
  const canvas = document.getElementById("tracker-canvas");
  const ctx = canvas.getContext("2d");
  const fpsBadge = document.getElementById("fps-counter");
  const lightingBadge = document.getElementById("lighting-badge");
  const speechStatus = document.getElementById("speech-status");
  const transcriptChip = document.getElementById("transcript-chip");
  const cursorPosEl = document.getElementById("cursor-pos");
  const actionCountEl = document.getElementById("action-count");
  const activeModeEl = document.getElementById("active-mode");
  const recenterBtn = document.getElementById("recenter-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const permOverlay = document.getElementById("perm-overlay");
  const grantPermBtn = document.getElementById("grant-perm-btn");

  let stream = null;
  let isRunning = true;
  let actionCount = 0;
  let settings = {
    sensitivity: 1.4,
    smoothing: 0.75,
    mode: "hybrid",
  };

  // Tracking Coordinates
  let anchorX = 0.5;
  let anchorY = 0.5;
  let currNormX = 0.5;
  let currNormY = 0.5;
  let targetNormX = 0.5;
  let targetNormY = 0.5;

  // Performance metrics
  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  let lastVideoTime = -1;

  // Initialize Settings
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
    if (res?.state) {
      settings = { ...settings, ...res.state };
      if (activeModeEl) activeModeEl.textContent = settings.mode;
    }
  });

  // 1. Camera Initialization
  async function initCamera() {
    try {
      if (permOverlay) permOverlay.style.display = "none";
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
          facingMode: "user",
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;

      lightingBadge.textContent = "Lighting: Optimal";
      lightingBadge.style.color = "#7bd3c2";

      requestAnimationFrame(processFrame);
    } catch (err) {
      console.warn("Camera access error:", err);
      if (permOverlay) permOverlay.style.display = "flex";
      lightingBadge.textContent = "Camera Permission Needed";
      lightingBadge.style.color = "#fbbf24";
    }
  }

  grantPermBtn?.addEventListener("click", () => {
    initCamera();
    initSpeech();
  });

  // 2. Head Motion Analysis (High-performance Optical Centroid Tracker)
  let prevFrameData = null;

  function processFrame(now) {
    if (!isRunning) return;

    // FPS Counter
    frameCount++;
    if (now - lastFpsUpdate >= 1000) {
      fpsBadge.textContent = `${frameCount} FPS`;
      frameCount = 0;
      lastFpsUpdate = now;
    }

    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = frame.data;

      // Calculate luminosity and motion centroid
      let totalLum = 0;
      let motionX = 0;
      let motionY = 0;
      let motionCount = 0;

      // Sample central face region (box of 160x160 in center)
      const startX = Math.floor(canvas.width * 0.2);
      const endX = Math.floor(canvas.width * 0.8);
      const startY = Math.floor(canvas.height * 0.2);
      const endY = Math.floor(canvas.height * 0.8);

      for (let y = startY; y < endY; y += 4) {
        for (let x = startX; x < endX; x += 4) {
          const idx = (y * canvas.width + x) * 4;
          const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          totalLum += lum;

          if (prevFrameData) {
            const prevLum = (prevFrameData[idx] + prevFrameData[idx + 1] + prevFrameData[idx + 2]) / 3;
            const diff = Math.abs(lum - prevLum);
            if (diff > 18) {
              motionX += x;
              motionY += y;
              motionCount++;
            }
          }
        }
      }

      // Update Lighting Quality
      const samplePixels = ((endX - startX) / 4) * ((endY - startY) / 4);
      const avgLum = totalLum / samplePixels;
      if (avgLum < 40) {
        lightingBadge.textContent = "Lighting: Too Dark";
        lightingBadge.style.color = "#f87171";
      } else if (avgLum > 220) {
        lightingBadge.textContent = "Lighting: Too Bright";
        lightingBadge.style.color = "#fbbf24";
      } else {
        lightingBadge.textContent = "Lighting: Optimal";
        lightingBadge.style.color = "#7bd3c2";
      }

      // If active head movement detected
      if (motionCount > 15) {
        const detectedCenterX = motionX / motionCount / canvas.width;
        const detectedCenterY = motionY / motionCount / canvas.height;

        // Relative offset from anchor
        const dx = (detectedCenterX - anchorX) * settings.sensitivity;
        const dy = (detectedCenterY - anchorY) * settings.sensitivity;

        targetNormX = Math.max(0.02, Math.min(0.98, 0.5 + dx * 2.8));
        targetNormY = Math.max(0.02, Math.min(0.98, 0.5 + dy * 2.8));
      }

      // Smooth coordinate update
      currNormX += (targetNormX - currNormX) * (1 - settings.smoothing);
      currNormY += (targetNormY - currNormY) * (1 - settings.smoothing);

      // Render Visual Reticle on Canvas
      ctx.beginPath();
      ctx.arc(currNormX * canvas.width, currNormY * canvas.height, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#7bd3c2";
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Emit coordinates to Background -> Content Script
      chrome.runtime.sendMessage({
        type: "TRACKER_CURSOR_UPDATE",
        payload: {
          x: currNormX,
          y: currNormY,
          source: "head",
        },
      });

      if (cursorPosEl) {
        cursorPosEl.textContent = `${Math.round(currNormX * 100)}%, ${Math.round(currNormY * 100)}%`;
      }

      prevFrameData = data;
    }

    requestAnimationFrame(processFrame);
  }

  // 3. Continuous Voice Navigation & Dictation
  let recognition = null;

  function initSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speechStatus.textContent = "Speech API Not Supported";
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      speechStatus.textContent = "Listening Active";
      speechStatus.style.color = "#7bd3c2";
    };

    recognition.onerror = (e) => {
      console.warn("Speech error:", e.error);
      if (e.error === "not-allowed") {
        speechStatus.textContent = "Mic Permission Denied";
        speechStatus.style.color = "#f87171";
      }
    };

    recognition.onend = () => {
      // Auto-restart recognition to keep hands-free listening alive
      if (isRunning) {
        try {
          recognition.start();
        } catch {}
      }
    };

    recognition.onresult = (e) => {
      const result = e.results[e.results.length - 1];
      if (!result) return;
      const transcript = result[0].transcript.trim().toLowerCase();
      transcriptChip.textContent = `"${transcript}"`;

      handleVoiceCommand(transcript);
    };

    try {
      recognition.start();
    } catch (err) {
      console.warn("Recognition start error:", err);
    }
  }

  // 4. Voice Command Interpreter
  function handleVoiceCommand(raw) {
    const text = raw.replace(/[.,!?]/g, "").trim();
    let action = null;
    let payload = null;

    // Click / Select
    if (/\b(click|press|select|tap|hit|submit)\b/.test(text)) {
      action = "CLICK";
    }

    // Numbered Badge Selection (e.g., "click 3", "number 5", "select 12")
    const numMatch = text.match(/\b(?:click|press|select|open|number)\s+(\d+)\b/);
    if (numMatch) {
      action = "CLICK_NUMBER";
      payload = parseInt(numMatch[1], 10);
    } else {
      // Numbers as words
      const wordsToNum = {
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      for (const [word, val] of Object.entries(wordsToNum)) {
        if (text.includes(`click ${word}`) || text.includes(`number ${word}`)) {
          action = "CLICK_NUMBER";
          payload = val;
          break;
        }
      }
    }

    // Scrolling
    if (/\b(scroll down|go down|page down|down)\b/.test(text)) {
      action = "SCROLL";
      payload = { direction: "down", amount: 450 };
    } else if (/\b(scroll up|go up|page up|up)\b/.test(text)) {
      action = "SCROLL";
      payload = { direction: "up", amount: 450 };
    } else if (/\b(scroll top|top of page|go to top)\b/.test(text)) {
      action = "SCROLL";
      payload = { direction: "top" };
    } else if (/\b(scroll bottom|bottom of page|go to bottom)\b/.test(text)) {
      action = "SCROLL";
      payload = { direction: "bottom" };
    }

    // Numbers Visibility
    if (/\b(show numbers|numbers on|display numbers)\b/.test(text)) {
      action = "SHOW_NUMBERS";
    } else if (/\b(hide numbers|numbers off|remove numbers)\b/.test(text)) {
      action = "HIDE_NUMBERS";
    }

    // Search Dictation (e.g., "search for artificial intelligence", "find jobs")
    const searchMatch = text.match(/\b(?:search for|search|look up|find)\s+(.+)\b/);
    if (searchMatch && !action) {
      action = "SEARCH";
      payload = searchMatch[1].trim();
    }

    // Direct Typing Dictation (e.g., "type hello world")
    const typeMatch = text.match(/\b(?:type|enter|write)\s+(.+)\b/);
    if (typeMatch && !action) {
      action = "TYPE";
      payload = typeMatch[1].trim();
    }

    // Browser Navigation
    if (/\b(go back|navigate back|back page)\b/.test(text) || text === "back") {
      action = "NAV_BACK";
    } else if (/\b(go forward|forward page)\b/.test(text) || text === "forward") {
      action = "NAV_FORWARD";
    } else if (/\b(reload|refresh|reload page)\b/.test(text)) {
      action = "NAV_RELOAD";
    }

    if (action) {
      actionCount++;
      if (actionCountEl) actionCountEl.textContent = `${actionCount}`;

      chrome.runtime.sendMessage({
        type: "TRACKER_ACTION",
        action,
        payload,
      });
    }
  }

  // Recenter calibration
  function recenter() {
    anchorX = currNormX;
    anchorY = currNormY;
    targetNormX = 0.5;
    targetNormY = 0.5;
    currNormX = 0.5;
    currNormY = 0.5;
    transcriptChip.textContent = "Head centered! Tracking reset to 50%, 50%";
  }

  recenterBtn.addEventListener("click", recenter);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      recenter();
    }
  });

  pauseBtn.addEventListener("click", () => {
    isRunning = !isRunning;
    pauseBtn.textContent = isRunning ? "Pause" : "Resume";
    if (isRunning) requestAnimationFrame(processFrame);
  });

  // Start engines
  initCamera();
  initSpeech();
})();
