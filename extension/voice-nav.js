(function () {
  if (window.__VOICE_NAV_INITIALIZED__) {
    return;
  }
  window.__VOICE_NAV_INITIALIZED__ = true;

  const HallucinationFilter = {
    patterns: [
      /^thank you[.!]?$/i,
      /^thanks for watching[.!]?$/i,
      /^bye[.!]?$/i,
      /^you[.!]?$/i,
      /^\.+$/,
      /^subtitles by/i,
      /^translated by/i,
      /^subscribe[.!]?$/i,
      /^mbc[.!]?$/i,
      /^thank you very much[.!]?$/i,
      /^goodbye[.!]?$/i,
      /^silence[.!]?$/i
    ],
    isHallucination(text) {
      if (!text || typeof text !== 'string') return true;
      const clean = text.trim();
      if (clean.length < 2) return true;
      return this.patterns.some((pattern) => pattern.test(clean));
    }
  };

  const ApiClient = {
    isExtension: typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id),
    serverUrl: window.VOICE_NAV_SERVER_URL || 'http://localhost:3001',
    audioElement: null,
    isSpeaking: false,
    audioCache: new Map(),

    init() {
      const scriptTag = document.querySelector('script[data-voice-nav-server]');
      if (scriptTag && scriptTag.dataset.voiceNavServer) {
        this.serverUrl = scriptTag.dataset.voiceNavServer;
      }
    },

    async transcribe(audioBlob, language) {
      if (this.isExtension) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            chrome.runtime.sendMessage(
              {
                type: 'VOICE_NAV_TRANSCRIBE',
                dataUrl: reader.result,
                language: language || 'en'
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  return reject(new Error(chrome.runtime.lastError.message));
                }
                if (response && response.error) {
                  return reject(new Error(response.error));
                }
                resolve(response ? response.text : '');
              }
            );
          };
          reader.onerror = () => reject(new Error('Failed to read audio blob'));
          reader.readAsDataURL(audioBlob);
        });
      }

      const formData = new FormData();
      formData.append('audio', audioBlob, 'speech.webm');
      if (language && language !== 'auto') {
        formData.append('language', language);
      }

      const response = await fetch(`${this.serverUrl}/transcribe`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Transcription failed with status ${response.status}`);
      }

      const data = await response.json();
      return data.text || '';
    },

    async speak(text, onComplete) {
      if (!text || text.trim() === '') {
        if (onComplete) onComplete();
        return;
      }

      const cleanText = text.trim();
      this.isSpeaking = true;

      try {
        let audioUrl = this.audioCache.get(cleanText.toLowerCase());

        if (!audioUrl) {
          if (this.isExtension) {
            audioUrl = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                {
                  type: 'VOICE_NAV_SPEAK',
                  text: cleanText
                },
                (response) => {
                  if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                  }
                  if (response && response.error) {
                    return reject(new Error(response.error));
                  }
                  resolve(response.dataUrl);
                }
              );
            });
          } else {
            const response = await fetch(`${this.serverUrl}/speak`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: cleanText })
            });

            if (!response.ok) {
              throw new Error(`Speech synthesis failed with status ${response.status}`);
            }

            const blob = await response.blob();
            audioUrl = URL.createObjectURL(blob);
          }

          if (this.audioCache.size > 100) {
            const firstKey = this.audioCache.keys().next().value;
            this.audioCache.delete(firstKey);
          }
          this.audioCache.set(cleanText.toLowerCase(), audioUrl);
        }

        if (!this.audioElement) {
          this.audioElement = new Audio();
        }

        this.audioElement.src = audioUrl;

        const finishPlayback = () => {
          this.isSpeaking = false;
          if (onComplete) onComplete();
        };

        this.audioElement.onended = finishPlayback;
        this.audioElement.onerror = finishPlayback;

        await this.audioElement.play();
      } catch (err) {
        this.isSpeaking = false;
        if (onComplete) onComplete();
      }
    },

    async resolveIntent(transcript, elements) {
      if (this.isExtension) {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'VOICE_NAV_INTENT',
              transcript,
              elements
            },
            (response) => {
              if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
              }
              if (response && response.error) {
                return reject(new Error(response.error));
              }
              resolve(response || { action: 'none', target: null });
            }
          );
        });
      }

      const response = await fetch(`${this.serverUrl}/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, elements })
      });

      if (!response.ok) {
        throw new Error(`Intent resolution failed with status ${response.status}`);
      }

      return await response.json();
    }
  };

  const DwellCursor = {
    cursorContainer: null,
    cursorEl: null,
    meterEl: null,
    pipEl: null,
    audioCtx: null,

    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    targetX: window.innerWidth / 2,
    targetY: window.innerHeight / 2,
    dwellStartTime: 0,
    dwellAnchorX: 0,
    dwellAnchorY: 0,
    dwellRadius: 28,
    dwellDelayMs: 1200,
    lastClickTime: 0,
    isEnabled: false,
    animFrameId: null,

    init() {
      if (document.getElementById('voice-nav-cursor-root')) return;

      const root = document.createElement('div');
      root.id = 'voice-nav-cursor-root';
      root.style.all = 'initial';

      const style = document.createElement('style');
      style.textContent = `
        #voice-nav-cursor-box {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          pointer-events: none;
          z-index: 2147483640;
          display: none;
        }
        #voice-nav-cursor-box.active {
          display: block;
        }
        #voice-nav-virtual-pointer {
          position: absolute;
          width: 36px;
          height: 36px;
          transform: translate(-50%, -50%);
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.04s ease-out;
        }
        .voice-nav-pointer-center {
          width: 12px;
          height: 12px;
          background: #38bdf8;
          border: 2px solid #0f172a;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.9), 0 0 3px rgba(0, 0, 0, 0.8);
          position: absolute;
        }
        .voice-nav-pointer-meter {
          width: 38px;
          height: 38px;
          transform: rotate(-90deg);
        }
        .voice-nav-meter-bg {
          fill: none;
          stroke: rgba(15, 23, 42, 0.6);
          stroke-width: 3.5;
        }
        .voice-nav-meter-fill {
          fill: none;
          stroke: #38bdf8;
          stroke-width: 3.5;
          stroke-linecap: round;
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
        }
        .voice-nav-click-ripple {
          position: absolute;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 2px solid #38bdf8;
          transform: translate(-50%, -50%) scale(0.2);
          opacity: 1;
          pointer-events: none;
          animation: voiceNavRipple 0.5s ease-out forwards;
        }
        @keyframes voiceNavRipple {
          to {
            transform: translate(-50%, -50%) scale(1.8);
            opacity: 0;
          }
        }
        #voice-nav-camera-pip {
          position: fixed;
          bottom: 24px;
          left: 24px;
          width: 140px;
          height: 105px;
          background: #090d16;
          border: 1.5px solid rgba(56, 189, 248, 0.4);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          z-index: 2147483645;
          display: none;
        }
        #voice-nav-camera-pip.active {
          display: block;
        }
        #voice-nav-pip-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transform: scaleX(-1);
          opacity: 0.85;
        }
        #voice-nav-pip-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          transform: scaleX(-1);
          pointer-events: none;
        }
        .voice-nav-pip-badge {
          position: absolute;
          bottom: 4px;
          left: 6px;
          font-size: 9px;
          font-weight: 700;
          background: rgba(15, 23, 42, 0.8);
          color: #38bdf8;
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid rgba(56, 189, 248, 0.3);
        }
      `;

      const box = document.createElement('div');
      box.id = 'voice-nav-cursor-box';

      const pointer = document.createElement('div');
      pointer.id = 'voice-nav-virtual-pointer';
      pointer.innerHTML = `
        <svg class="voice-nav-pointer-meter" viewBox="0 0 36 36">
          <circle class="voice-nav-meter-bg" cx="18" cy="18" r="15"/>
          <circle class="voice-nav-meter-fill" id="voice-nav-meter-fill-circle" cx="18" cy="18" r="15" stroke-dasharray="100" stroke-dashoffset="100"/>
        </svg>
        <div class="voice-nav-pointer-center"></div>
      `;

      const pip = document.createElement('div');
      pip.id = 'voice-nav-camera-pip';
      pip.innerHTML = `
        <video id="voice-nav-pip-video" autoplay playsinline muted></video>
        <canvas id="voice-nav-pip-canvas"></canvas>
        <span class="voice-nav-pip-badge" id="voice-nav-pip-status">Eye Track: Active</span>
      `;

      box.appendChild(pointer);
      root.appendChild(style);
      root.appendChild(box);
      root.appendChild(pip);
      document.body.appendChild(root);

      this.cursorContainer = box;
      this.cursorEl = pointer;
      this.meterEl = pointer.querySelector('#voice-nav-meter-fill-circle');
      this.pipEl = pip;

      this.startLoop();
    },

    playClickSound() {
      try {
        if (!this.audioCtx) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          this.audioCtx = new AudioContextClass();
        }
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, this.audioCtx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.18, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.06);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.06);
      } catch (e) {}
    },

    showRipple(x, y) {
      const ripple = document.createElement('div');
      ripple.className = 'voice-nav-click-ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      this.cursorContainer.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },

    updateTarget(normX, normY) {
      const margin = 20;
      const targetW = window.innerWidth - margin * 2;
      const targetH = window.innerHeight - margin * 2;
      this.targetX = margin + Math.max(0, Math.min(1, normX)) * targetW;
      this.targetY = margin + Math.max(0, Math.min(1, normY)) * targetH;
    },

    startLoop() {
      const loop = () => {
        if (this.isEnabled) {
          this.x += (this.targetX - this.x) * 0.28;
          this.y += (this.targetY - this.y) * 0.28;

          this.cursorEl.style.left = `${this.x}px`;
          this.cursorEl.style.top = `${this.y}px`;

          this.checkDwell();
        }
        this.animFrameId = requestAnimationFrame(loop);
      };
      this.animFrameId = requestAnimationFrame(loop);
    },

    checkDwell() {
      const now = performance.now();
      if (now - this.lastClickTime < 600) {
        if (this.meterEl) this.meterEl.style.strokeDashoffset = '100';
        return;
      }

      const dist = Math.hypot(this.x - this.dwellAnchorX, this.y - this.dwellAnchorY);

      if (dist > this.dwellRadius) {
        this.dwellAnchorX = this.x;
        this.dwellAnchorY = this.y;
        this.dwellStartTime = now;
        if (this.meterEl) this.meterEl.style.strokeDashoffset = '100';
      } else {
        const elapsed = now - this.dwellStartTime;
        const progress = Math.min(1, elapsed / this.dwellDelayMs);
        if (this.meterEl) {
          this.meterEl.style.strokeDashoffset = `${100 - progress * 100}`;
        }

        if (progress >= 1) {
          this.executeDwellClick();
          this.dwellStartTime = now;
          this.lastClickTime = now;
          if (this.meterEl) this.meterEl.style.strokeDashoffset = '100';
        }
      }
    },

    executeDwellClick() {
      this.playClickSound();
      this.showRipple(this.x, this.y);

      this.cursorContainer.style.display = 'none';
      const target = document.elementFromPoint(this.x, this.y);
      this.cursorContainer.style.display = 'block';

      if (target && !target.closest('#voice-nav-root') && !target.closest('#voice-nav-cursor-root')) {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: this.x, clientY: this.y }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: this.x, clientY: this.y }));
        target.click();
        if (target.focus) target.focus();
      }
    },

    triggerInstantClick() {
      this.executeDwellClick();
    },

    setVisible(active) {
      this.isEnabled = active;
      if (this.cursorContainer) {
        this.cursorContainer.className = active ? 'active' : '';
      }
      if (this.pipEl) {
        this.pipEl.className = active ? 'active' : '';
      }
    }
  };

  const EyeTracker = {
    stream: null,
    video: null,
    canvas: null,
    ctx: null,
    isRunning: false,
    sensitivity: 1.5,
    smoothing: 0.75,
    anchorX: 0.5,
    anchorY: 0.5,
    currNormX: 0.5,
    currNormY: 0.5,
    targetNormX: 0.5,
    targetNormY: 0.5,
    prevFrameData: null,

    async start(onReady, onError) {
      DwellCursor.init();

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 320 },
            height: { ideal: 240 },
            facingMode: 'user'
          },
          audio: false
        });

        this.video = document.getElementById('voice-nav-pip-video');
        this.canvas = document.getElementById('voice-nav-pip-canvas');

        if (this.video && this.canvas) {
          this.video.srcObject = this.stream;
          await this.video.play();

          this.canvas.width = this.video.videoWidth || 320;
          this.canvas.height = this.video.videoHeight || 240;
          this.ctx = this.canvas.getContext('2d');
        }

        this.isRunning = true;
        DwellCursor.setVisible(true);
        this.processLoop();

        if (onReady) onReady();
      } catch (err) {
        if (onError) onError(err);
      }
    },

    recenter() {
      this.anchorX = this.currNormX;
      this.anchorY = this.currNormY;
      this.targetNormX = 0.5;
      this.targetNormY = 0.5;
      this.currNormX = 0.5;
      this.currNormY = 0.5;
    },

    processLoop() {
      if (!this.isRunning) return;

      if (this.video && this.video.readyState >= 2 && this.ctx) {
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        const frame = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = frame.data;

        let motionX = 0;
        let motionY = 0;
        let motionCount = 0;

        const startX = Math.floor(this.canvas.width * 0.2);
        const endX = Math.floor(this.canvas.width * 0.8);
        const startY = Math.floor(this.canvas.height * 0.2);
        const endY = Math.floor(this.canvas.height * 0.8);

        for (let y = startY; y < endY; y += 4) {
          for (let x = startX; x < endX; x += 4) {
            const idx = (y * this.canvas.width + x) * 4;
            const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;

            if (this.prevFrameData) {
              const prevLum =
                (this.prevFrameData[idx] + this.prevFrameData[idx + 1] + this.prevFrameData[idx + 2]) / 3;
              const diff = Math.abs(lum - prevLum);
              if (diff > 16) {
                motionX += x;
                motionY += y;
                motionCount++;
              }
            }
          }
        }

        if (motionCount > 12) {
          const detectedX = motionX / motionCount / this.canvas.width;
          const detectedY = motionY / motionCount / this.canvas.height;

          const dx = (detectedX - this.anchorX) * this.sensitivity;
          const dy = (detectedY - this.anchorY) * this.sensitivity;

          this.targetNormX = Math.max(0.02, Math.min(0.98, 0.5 + dx * 2.8));
          this.targetNormY = Math.max(0.02, Math.min(0.98, 0.5 + dy * 2.8));
        }

        this.currNormX += (this.targetNormX - this.currNormX) * (1 - this.smoothing);
        this.currNormY += (this.targetNormY - this.currNormY) * (1 - this.smoothing);

        DwellCursor.updateTarget(this.currNormX, this.currNormY);

        this.ctx.beginPath();
        this.ctx.arc(this.currNormX * this.canvas.width, this.currNormY * this.canvas.height, 8, 0, Math.PI * 2);
        this.ctx.fillStyle = '#38bdf8';
        this.ctx.fill();
        this.ctx.strokeStyle = '#0f172a';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        this.prevFrameData = data;
      }

      requestAnimationFrame(() => this.processLoop());
    },

    stop() {
      this.isRunning = false;
      DwellCursor.setVisible(false);

      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
    }
  };

  const DOMActions = {
    elementsCache: [],

    getVisibleInteractiveElements() {
      const candidates = Array.from(
        document.querySelectorAll(
          'a, button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], summary, [role="link"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
        )
      );

      const visible = [];
      let index = 0;

      for (const el of candidates) {
        if (el.closest('#voice-nav-root') || el.closest('#voice-nav-cursor-root')) {
          continue;
        }

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isShown =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.opacity !== '0';

        if (!isShown) {
          continue;
        }

        const rawText =
          el.innerText ||
          el.value ||
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.getAttribute('placeholder') ||
          '';

        const text = rawText.replace(/\s+/g, ' ').trim();
        if (text) {
          visible.push({
            index,
            text: text.slice(0, 100),
            tag: el.tagName.toLowerCase(),
            element: el
          });
          index++;
        }
      }

      this.elementsCache = visible;
      return visible;
    },

    highlightAndClick(element) {
      if (!element) return false;

      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const originalOutline = element.style.outline;
      const originalTransition = element.style.transition;
      const originalBoxShadow = element.style.boxShadow;

      element.style.transition = 'all 0.25s ease-in-out';
      element.style.outline = '3px solid #ef4444';
      element.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.7)';

      setTimeout(() => {
        element.style.outline = originalOutline;
        element.style.transition = originalTransition;
        element.style.boxShadow = originalBoxShadow;
        element.click();
      }, 450);

      return true;
    },

    findAndClick(query) {
      const q = query.trim().toLowerCase();
      const list = this.getVisibleInteractiveElements();

      let exactMatch = list.find((item) => item.text.toLowerCase() === q);
      if (exactMatch) {
        return this.highlightAndClick(exactMatch.element);
      }

      let startMatch = list.find((item) => item.text.toLowerCase().startsWith(q));
      if (startMatch) {
        return this.highlightAndClick(startMatch.element);
      }

      let includeMatch = list.find((item) => item.text.toLowerCase().includes(q));
      if (includeMatch) {
        return this.highlightAndClick(includeMatch.element);
      }

      return false;
    },

    clickByIndex(targetIndex) {
      const idx = typeof targetIndex === 'number' ? targetIndex : parseInt(targetIndex, 10);
      const match = this.elementsCache.find((item) => item.index === idx);
      if (match && match.element) {
        return this.highlightAndClick(match.element);
      }
      return false;
    },

    typeIntoFocused(text) {
      let target = document.activeElement;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('contenteditable') === 'true');

      if (!isInput) {
        target = document.querySelector(
          'input[type="text"]:not([disabled]), input[type="search"]:not([disabled]), textarea:not([disabled]), input:not([type]):not([disabled])'
        );
      }

      if (!target) {
        return false;
      }

      target.focus();

      if (target.isContentEditable) {
        target.innerText = text;
      } else {
        target.value = text;
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },

    readPage() {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((h) => h.innerText.trim())
        .filter(Boolean);
      const paragraphs = Array.from(document.querySelectorAll('main p, article p, p'))
        .map((p) => p.innerText.trim())
        .filter((txt) => txt.length > 20);

      const snippets = [...headings.slice(0, 3), ...paragraphs.slice(0, 3)];
      const combined = snippets.join('. ');

      if (!combined) {
        return 'No readable text content found on this page.';
      }

      return combined.length > 400 ? combined.slice(0, 400) + '...' : combined;
    }
  };

  const CommandParser = {
    customCommands: {},

    loadCustomCommands() {
      try {
        const stored = localStorage.getItem('voice_nav_custom_commands');
        if (stored) {
          this.customCommands = JSON.parse(stored);
        }
      } catch (e) {
        this.customCommands = {};
      }
    },

    saveCustomCommands(map) {
      this.customCommands = map || {};
      try {
        localStorage.setItem('voice_nav_custom_commands', JSON.stringify(this.customCommands));
      } catch (e) {}
    },

    async parseAndExecute(rawTranscript, onStatus) {
      if (!rawTranscript) return;
      const transcript = rawTranscript.trim().toLowerCase();
      onStatus(`Heard: "${transcript}"`);

      for (const [phrase, actionName] of Object.entries(this.customCommands)) {
        if (transcript === phrase.toLowerCase() || transcript.includes(phrase.toLowerCase())) {
          return this.executeAction(actionName, null, onStatus);
        }
      }

      if (
        transcript === 'enable eye tracking' ||
        transcript === 'start eye tracking' ||
        transcript === 'start tracking'
      ) {
        VoiceNavApp.toggleEyeTracking(true);
        return onStatus('Eye tracking enabled', 'Eye tracking active');
      }

      if (
        transcript === 'disable eye tracking' ||
        transcript === 'stop eye tracking' ||
        transcript === 'stop tracking'
      ) {
        VoiceNavApp.toggleEyeTracking(false);
        return onStatus('Eye tracking disabled', 'Eye tracking stopped');
      }

      if (transcript === 'recenter' || transcript === 'center head' || transcript === 'center') {
        EyeTracker.recenter();
        return onStatus('Gaze centered', 'Centered');
      }

      if (transcript === 'scroll down' || transcript === 'down' || transcript === 'page down') {
        window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });
        return onStatus('Scrolling down', 'Scrolling down');
      }

      if (transcript === 'scroll up' || transcript === 'up' || transcript === 'page up') {
        window.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' });
        return onStatus('Scrolling up', 'Scrolling up');
      }

      if (
        transcript === 'go to top' ||
        transcript === 'scroll to top' ||
        transcript === 'top of page' ||
        transcript === 'top'
      ) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return onStatus('Going to top', 'Going to top');
      }

      if (
        transcript === 'go to bottom' ||
        transcript === 'scroll to bottom' ||
        transcript === 'bottom of page' ||
        transcript === 'bottom'
      ) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        return onStatus('Going to bottom', 'Going to bottom');
      }

      if (transcript === 'go back' || transcript === 'back') {
        history.back();
        return onStatus('Navigating back', 'Going back');
      }

      if (transcript === 'go forward' || transcript === 'forward') {
        history.forward();
        return onStatus('Navigating forward', 'Going forward');
      }

      if (transcript === 'refresh' || transcript === 'reload' || transcript === 'reload page') {
        onStatus('Refreshing page', 'Refreshing page', () => location.reload());
        return;
      }

      if (transcript === 'read this page' || transcript === 'read page' || transcript === 'read') {
        const textToRead = DOMActions.readPage();
        return onStatus('Reading page', textToRead);
      }

      if (transcript === 'stop listening' || transcript === 'stop') {
        VoiceNavApp.stopListening();
        return onStatus('Stopped listening', 'Voice navigation paused');
      }

      if (
        transcript === 'help' ||
        transcript === 'what can i say' ||
        transcript === 'commands' ||
        transcript === 'show commands' ||
        transcript === 'open help'
      ) {
        VoiceNavApp.showHelpModal(true);
        return onStatus('Commands guide open', 'Here are the available voice commands');
      }

      if (transcript === 'close help' || transcript === 'hide help' || transcript === 'dismiss') {
        VoiceNavApp.showHelpModal(false);
        return onStatus('Commands guide closed', 'Help dismissed');
      }

      if (
        transcript === 'click' ||
        transcript === 'press' ||
        transcript === 'select' ||
        transcript === 'click that' ||
        transcript === 'click this' ||
        transcript === 'click here' ||
        transcript === 'press this' ||
        transcript === 'press that' ||
        transcript === 'select this' ||
        transcript === 'select that' ||
        transcript === 'tap here' ||
        transcript === 'tap that'
      ) {
        if (EyeTracker.isRunning) {
          DwellCursor.triggerInstantClick();
          return onStatus('Clicked gaze point', 'Clicked');
        }
      }

      if (
        transcript === 'go to jobs' ||
        transcript === 'jobs' ||
        transcript === 'open jobs' ||
        transcript === 'job search'
      ) {
        onStatus('Opening Jobs', 'Opening Jobs', () => { window.location.href = '/jobs'; });
        return;
      }

      if (
        transcript === 'go to dashboard' ||
        transcript === 'dashboard' ||
        transcript === 'open dashboard'
      ) {
        onStatus('Opening Dashboard', 'Opening Dashboard', () => { window.location.href = '/dashboard'; });
        return;
      }

      if (
        transcript === 'go to workstation' ||
        transcript === 'workstation' ||
        transcript === 'browse' ||
        transcript === 'go to browse'
      ) {
        onStatus('Opening Workstation', 'Opening Workstation', () => { window.location.href = '/browse'; });
        return;
      }

      if (
        transcript === 'go to calibration' ||
        transcript === 'calibrate' ||
        transcript === 'calibration'
      ) {
        onStatus('Opening Calibration', 'Opening Calibration', () => { window.location.href = '/calibration'; });
        return;
      }

      if (
        transcript === 'go to evaluation' ||
        transcript === 'evaluate' ||
        transcript === 'benchmarks' ||
        transcript === 'benchmark'
      ) {
        onStatus('Opening Evaluation Suite', 'Opening Evaluation Suite', () => { window.location.href = '/evaluate'; });
        return;
      }

      if (
        transcript === 'go to extension' ||
        transcript === 'extension' ||
        transcript === 'chrome extension'
      ) {
        onStatus('Opening Chrome Extension', 'Opening Chrome Extension', () => { window.location.href = '/extension'; });
        return;
      }

      if (
        transcript === 'go to resume match' ||
        transcript === 'resume match' ||
        transcript === 'match resume'
      ) {
        onStatus('Opening Resume Match', 'Opening Resume Match', () => { window.location.href = '/resume-match'; });
        return;
      }

      if (
        transcript === 'go to profile' ||
        transcript === 'profile' ||
        transcript === 'my profile'
      ) {
        onStatus('Opening Profile', 'Opening Profile', () => { window.location.href = '/profile'; });
        return;
      }

      if (
        transcript === 'go to applications' ||
        transcript === 'applications' ||
        transcript === 'my applications'
      ) {
        onStatus('Opening Applications', 'Opening Applications', () => { window.location.href = '/applications'; });
        return;
      }

      if (
        transcript === 'go to employer' ||
        transcript === 'employer' ||
        transcript === 'post a job'
      ) {
        onStatus('Opening Employer Portal', 'Opening Employer Portal', () => { window.location.href = '/employer'; });
        return;
      }

      if (transcript === 'go home' || transcript === 'home') {
        onStatus('Going Home', 'Going Home', () => { window.location.href = '/'; });
        return;
      }

      const searchMatch = transcript.match(/^(?:search for|search|find jobs for|find)\s+(.+)$/i);
      if (searchMatch) {
        const query = searchMatch[1].trim();
        const searchInput = document.querySelector('input[type="search"], input[placeholder*="search" i], input[placeholder*="Search" i], input[type="text"]');
        if (searchInput) {
          searchInput.focus();
          searchInput.value = query;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          searchInput.dispatchEvent(new Event('change', { bubbles: true }));
          const form = searchInput.closest('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          return onStatus(`Searching: "${query}"`, `Searching ${query}`);
        }
      }

      if (
        transcript === 'clear input' ||
        transcript === 'clear search' ||
        transcript === 'clear'
      ) {
        let target = document.activeElement;
        if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) {
          target = document.querySelector('input[type="search"], input[type="text"], textarea');
        }
        if (target) {
          target.value = '';
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return onStatus('Cleared input', 'Cleared');
        }
      }

      if (
        transcript.includes('contrast') ||
        transcript === 'high contrast'
      ) {
        const btn = document.querySelector('[aria-label*="contrast" i], button:has(svg.lucide-sun), button:has(svg.lucide-moon)');
        if (btn) btn.click();
        return onStatus('Toggled contrast', 'Contrast toggled');
      }

      if (
        transcript.includes('ruler') ||
        transcript === 'reading ruler'
      ) {
        const btn = document.querySelector('[aria-label*="ruler" i]');
        if (btn) btn.click();
        return onStatus('Toggled reading ruler', 'Reading ruler toggled');
      }

      if (
        transcript.includes('captions') ||
        transcript === 'live captions'
      ) {
        const btn = document.querySelector('[aria-label*="captions" i]');
        if (btn) btn.click();
        return onStatus('Toggled live captions', 'Live captions toggled');
      }

      const typeMatch = transcript.match(/^(?:type|enter|write)\s+(?:into the focused field\s+)?(.+)$/i);
      if (typeMatch) {
        const textToType = typeMatch[1].replace(/into the focused field$/i, '').trim();
        const success = DOMActions.typeIntoFocused(textToType);
        if (success) {
          return onStatus(`Typed: "${textToType}"`, `Typed ${textToType}`);
        } else {
          return onStatus('No focused input found', 'No focused input field found');
        }
      }

      const clickMatch = transcript.match(/^(?:click|open|press|select)\s+(.+)$/i);
      if (clickMatch) {
        const targetQuery = clickMatch[1].trim();
        const clicked = DOMActions.findAndClick(targetQuery);
        if (clicked) {
          return onStatus(`Opening "${targetQuery}"`, `Opening ${targetQuery}`);
        } else {
          return onStatus(`Couldn't find "${targetQuery}"`, `Couldn't find ${targetQuery}`);
        }
      }

      const visible = DOMActions.getVisibleInteractiveElements();
      const payloadElements = visible.map((v) => ({
        index: v.index,
        text: v.text,
        tag: v.tag
      }));

      onStatus('Analyzing intent with AI...');

      try {
        const intent = await ApiClient.resolveIntent(transcript, payloadElements);
        return this.executeIntent(intent, onStatus);
      } catch (err) {
        return onStatus('Could not understand command', 'Could not understand command');
      }
    },

    executeAction(actionName, target, onStatus) {
      if (actionName === 'scroll_down') {
        window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });
        return onStatus('Scrolling down', 'Scrolling down');
      }
      if (actionName === 'scroll_up') {
        window.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' });
        return onStatus('Scrolling up', 'Scrolling up');
      }
      if (actionName === 'top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return onStatus('Going to top', 'Going to top');
      }
      if (actionName === 'bottom') {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        return onStatus('Going to bottom', 'Going to bottom');
      }
      if (actionName === 'back') {
        history.back();
        return onStatus('Going back', 'Going back');
      }
      if (actionName === 'forward') {
        history.forward();
        return onStatus('Going forward', 'Going forward');
      }
      if (actionName === 'refresh') {
        onStatus('Refreshing', 'Refreshing', () => location.reload());
        return;
      }
      if (actionName === 'read') {
        return onStatus('Reading page', DOMActions.readPage());
      }
    },

    executeIntent(intent, onStatus) {
      if (!intent || intent.action === 'none') {
        return onStatus('No matching action found', 'No matching action found');
      }

      if (intent.action === 'click') {
        const success = DOMActions.clickByIndex(intent.target);
        if (success) {
          return onStatus('Executing click', 'Clicking element');
        } else {
          return onStatus('Target element not available', 'Could not click element');
        }
      }

      if (intent.action === 'scroll') {
        if (intent.target === 'up') {
          window.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' });
          return onStatus('Scrolling up', 'Scrolling up');
        }
        if (intent.target === 'down') {
          window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });
          return onStatus('Scrolling down', 'Scrolling down');
        }
        if (intent.target === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return onStatus('Going to top', 'Going to top');
        }
        if (intent.target === 'bottom') {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          return onStatus('Going to bottom', 'Going to bottom');
        }
      }

      if (intent.action === 'navigate') {
        if (intent.target === 'back') {
          history.back();
          return onStatus('Navigating back', 'Going back');
        }
        if (intent.target === 'forward') {
          history.forward();
          return onStatus('Navigating forward', 'Going forward');
        }
        if (intent.target === 'refresh') {
          return onStatus('Refreshing', 'Refreshing', () => location.reload());
        }
      }

      if (intent.action === 'type') {
        const typed = DOMActions.typeIntoFocused(String(intent.target || ''));
        if (typed) {
          return onStatus(`Typed "${intent.target}"`, `Typed ${intent.target}`);
        } else {
          return onStatus('No input field focused', 'No input field found');
        }
      }

      return onStatus('No action executed', 'Command not recognized');
    }
  };

  const AudioCapture = {
    audioContext: null,
    analyser: null,
    microphone: null,
    mediaRecorder: null,
    audioChunks: [],
    mediaStream: null,
    isListening: false,
    isSpeakingDetected: false,
    silenceStartTime: 0,
    checkInterval: null,
    silenceThresholdMs: 900,
    rmsThreshold: 0.03,

    async start(onClipReady, onError) {
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.2;

        this.microphone = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.microphone.connect(this.analyser);

        this.startRecorder(onClipReady);
        this.isListening = true;
        this.monitorAudioLevels(onClipReady);
      } catch (err) {
        if (onError) onError(err);
      }
    },

    startRecorder(onClipReady) {
      this.audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const fullBlob = new Blob(this.audioChunks, { type: mimeType });
        this.audioChunks = [];

        if (fullBlob.size >= 4096 && !ApiClient.isSpeaking) {
          onClipReady(fullBlob);
        }

        if (this.isListening) {
          try {
            this.mediaRecorder.start();
          } catch (e) {}
        }
      };

      this.mediaRecorder.start();
    },

    monitorAudioLevels(onClipReady) {
      const buffer = new Float32Array(this.analyser.fftSize);

      const check = () => {
        if (!this.isListening) return;

        if (ApiClient.isSpeaking) {
          this.isSpeakingDetected = false;
          requestAnimationFrame(check);
          return;
        }

        this.analyser.getFloatTimeDomainData(buffer);

        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          sumSquares += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const now = Date.now();

        if (rms > this.rmsThreshold) {
          if (!this.isSpeakingDetected) {
            this.isSpeakingDetected = true;
            VoiceNavApp.setButtonState('speaking');
          }
          this.silenceStartTime = 0;
        } else if (this.isSpeakingDetected) {
          if (this.silenceStartTime === 0) {
            this.silenceStartTime = now;
          } else if (now - this.silenceStartTime >= this.silenceThresholdMs) {
            this.isSpeakingDetected = false;
            this.silenceStartTime = 0;
            VoiceNavApp.setButtonState('processing');

            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
              this.mediaRecorder.stop();
            }
          }
        }

        requestAnimationFrame(check);
      };

      requestAnimationFrame(check);
    },

    stop() {
      this.isListening = false;
      this.isSpeakingDetected = false;

      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        try {
          this.mediaRecorder.stop();
        } catch (e) {}
      }

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }

      if (this.audioContext && this.audioContext.state !== 'closed') {
        try {
          this.audioContext.close();
        } catch (e) {}
      }
    }
  };

  const VoiceNavApp = {
    isEnabled: false,
    isEyeTrackingEnabled: false,
    language: 'en',
    buttonEl: null,
    toastEl: null,
    eyeToggleBtn: null,

    init() {
      ApiClient.init();
      CommandParser.loadCustomCommands();
      this.loadSettings();
      this.createUI();
      this.setupExtensionListener();
    },

    loadSettings() {
      try {
        const storedLang = localStorage.getItem('voice_nav_language');
        if (storedLang) {
          this.language = storedLang;
        }
        const storedEye = localStorage.getItem('voice_nav_eyetracking');
        if (storedEye === 'true') {
          this.toggleEyeTracking(true);
        }
      } catch (e) {}

      if (ApiClient.isExtension) {
        try {
          chrome.storage.sync.get(
            ['voice_nav_enabled', 'voice_nav_language', 'voice_nav_eyetracking', 'voice_nav_custom_commands'],
            (res) => {
              if (res) {
                if (typeof res.voice_nav_enabled === 'boolean') {
                  if (res.voice_nav_enabled && !this.isEnabled) {
                    this.startListening();
                  } else if (!res.voice_nav_enabled && this.isEnabled) {
                    this.stopListening();
                  }
                }
                if (typeof res.voice_nav_eyetracking === 'boolean') {
                  this.toggleEyeTracking(res.voice_nav_eyetracking);
                }
                if (res.voice_nav_language) {
                  this.language = res.voice_nav_language;
                }
                if (res.voice_nav_custom_commands) {
                  CommandParser.saveCustomCommands(res.voice_nav_custom_commands);
                }
              }
            }
          );
        } catch (e) {}
      }
    },

    setupExtensionListener() {
      if (ApiClient.isExtension) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
          if (request.type === 'VOICE_NAV_SETTINGS_UPDATED') {
            if (typeof request.enabled === 'boolean') {
              if (request.enabled) this.startListening();
              else this.stopListening();
            }
            if (typeof request.eyetracking === 'boolean') {
              this.toggleEyeTracking(request.eyetracking);
            }
            if (request.language) {
              this.language = request.language;
            }
            if (request.customCommands) {
              CommandParser.saveCustomCommands(request.customCommands);
            }
            sendResponse({ ok: true });
          }
        });
      }
    },

    createUI() {
      const container = document.createElement('div');
      container.id = 'voice-nav-root';
      container.style.all = 'initial';

      const style = document.createElement('style');
      style.textContent = `
        #voice-nav-root * {
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #voice-nav-controls {
          position: fixed;
          bottom: 84px;
          right: 24px;
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 2147483647;
        }
        #voice-nav-btn {
          width: 58px;
          height: 58px;
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.2);
          background-color: #1e293b;
          color: #f8fafc;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s ease, background-color 0.25s ease, box-shadow 0.25s ease;
          outline: none;
        }
        #voice-nav-btn:hover {
          transform: scale(1.06);
        }
        #voice-nav-btn:focus-visible {
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.5);
        }
        #voice-nav-btn.listening {
          background-color: #ef4444;
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          animation: voiceNavPulse 1.6s infinite;
        }
        #voice-nav-btn.processing {
          background-color: #f59e0b;
        }
        #voice-nav-btn svg {
          width: 26px;
          height: 26px;
          fill: currentColor;
          pointer-events: none;
        }
        #voice-nav-eye-btn {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 1.5px solid rgba(255, 255, 255, 0.15);
          background-color: #1e293b;
          color: #94a3b8;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          outline: none;
        }
        #voice-nav-eye-btn:hover {
          transform: scale(1.08);
          color: #f8fafc;
        }
        #voice-nav-eye-btn.active {
          background-color: #0284c7;
          color: #f8fafc;
          border-color: #38bdf8;
          box-shadow: 0 0 12px rgba(56, 189, 248, 0.6);
        }
        #voice-nav-eye-btn svg {
          width: 20px;
          height: 20px;
          fill: currentColor;
          pointer-events: none;
        }
        #voice-nav-help-btn {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: 1.5px solid rgba(255, 255, 255, 0.15);
          background-color: #1e293b;
          color: #94a3b8;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          outline: none;
          font-weight: 700;
          font-size: 15px;
        }
        #voice-nav-help-btn:hover {
          transform: scale(1.08);
          color: #f8fafc;
          background-color: #334155;
        }
        #voice-nav-help-modal {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(8px);
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 2147483647;
          padding: 20px;
        }
        #voice-nav-help-modal.open {
          display: flex;
        }
        #voice-nav-help-card {
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 16px;
          max-width: 620px;
          width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          padding: 24px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
        }
        #voice-nav-toast {
          position: fixed;
          bottom: 156px;
          right: 24px;
          max-width: 320px;
          background: #0f172a;
          color: #f8fafc;
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 13px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.12);
          z-index: 2147483647;
          opacity: 0;
          pointer-events: none;
          transform: translateY(8px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          line-height: 1.4;
        }
        #voice-nav-toast.show {
          opacity: 1;
          transform: translateY(0);
        }
        @keyframes voiceNavPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          }
          70% {
            box-shadow: 0 0 0 14px rgba(239, 68, 68, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }
      `;

      const controlsWrap = document.createElement('div');
      controlsWrap.id = 'voice-nav-controls';

      const helpBtn = document.createElement('button');
      helpBtn.id = 'voice-nav-help-btn';
      helpBtn.type = 'button';
      helpBtn.setAttribute('aria-label', 'Open Voice Commands Guide');
      helpBtn.setAttribute('title', 'Voice Commands Guide');
      helpBtn.textContent = '?';

      const eyeBtn = document.createElement('button');
      eyeBtn.id = 'voice-nav-eye-btn';
      eyeBtn.type = 'button';
      eyeBtn.setAttribute('aria-label', 'Toggle Eye and Head Tracking');
      eyeBtn.setAttribute('title', 'Toggle Eye/Head Tracking (Alt+E)');
      eyeBtn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
      `;

      const btn = document.createElement('button');
      btn.id = 'voice-nav-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Voice Navigation: Click to start speaking');
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('tabindex', '0');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      `;

      const toast = document.createElement('div');
      toast.id = 'voice-nav-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');

      const helpModal = document.createElement('div');
      helpModal.id = 'voice-nav-help-modal';
      helpModal.innerHTML = `
        <div id="voice-nav-help-card">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:12px;margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:20px;">🎙️</span>
              <h2 style="font-size:18px;font-weight:700;margin:0;color:#f8fafc;">Handsfree Commands Guide</h2>
            </div>
            <button id="voice-nav-help-close" style="background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;">✕</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
            <div>
              <div style="color:#38bdf8;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:6px;">Navigation</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">scroll down / up</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">go to top / bottom</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">go back / forward</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">refresh / reload</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">go to jobs</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">go to dashboard</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">go to workstation</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">go home</span></div>
              </div>
            </div>
            <div>
              <div style="color:#38bdf8;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:6px;">Interaction & Pointing</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">click [text / label]</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">click that / click here</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">type [text]</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">search for [query]</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">clear input</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">read this page</span></div>
              </div>
            </div>
            <div>
              <div style="color:#38bdf8;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:6px;">Eye & Head Tracking</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">start eye tracking</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">stop eye tracking</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">recenter / Space</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#7dd3fc;font-family:monospace;">Dwell: hold gaze 1.2s</span></div>
              </div>
            </div>
            <div>
              <div style="color:#38bdf8;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:6px;">Keyboard Shortcuts</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#cbd5e1;"><kbd style="background:#334155;padding:2px 6px;border-radius:4px;">Alt+V</kbd> Toggle Voice</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#cbd5e1;"><kbd style="background:#334155;padding:2px 6px;border-radius:4px;">Alt+E</kbd> Toggle Tracking</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#cbd5e1;"><kbd style="background:#334155;padding:2px 6px;border-radius:4px;">Space</kbd> Recenter Gaze</span></div>
                <div style="background:rgba(255,255,255,0.04);padding:6px 10px;border-radius:6px;"><span style="color:#cbd5e1;"><kbd style="background:#334155;padding:2px 6px;border-radius:4px;">Esc</kbd> Close Guide</span></div>
              </div>
            </div>
          </div>
        </div>
      `;

      controlsWrap.appendChild(helpBtn);
      controlsWrap.appendChild(eyeBtn);
      controlsWrap.appendChild(btn);

      container.appendChild(style);
      container.appendChild(toast);
      container.appendChild(helpModal);
      container.appendChild(controlsWrap);
      document.body.appendChild(container);

      this.buttonEl = btn;
      this.toastEl = toast;
      this.eyeToggleBtn = eyeBtn;
      this.helpBtnEl = helpBtn;
      this.helpModalEl = helpModal;

      helpBtn.addEventListener('click', () => {
        this.showHelpModal(!this.helpModalEl.classList.contains('open'));
      });

      const closeBtn = helpModal.querySelector('#voice-nav-help-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.showHelpModal(false);
        });
      }

      helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) {
          this.showHelpModal(false);
        }
      });

      btn.addEventListener('click', () => {
        this.toggleListening();
      });

      eyeBtn.addEventListener('click', () => {
        this.toggleEyeTracking(!this.isEyeTrackingEnabled);
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.showHelpModal(false);
        } else if (e.altKey && (e.key === 'v' || e.key === 'V')) {
          e.preventDefault();
          this.toggleListening();
        } else if (e.altKey && (e.key === 'e' || e.key === 'E')) {
          e.preventDefault();
          this.toggleEyeTracking(!this.isEyeTrackingEnabled);
        } else if (e.code === 'Space' && this.isEyeTrackingEnabled && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          EyeTracker.recenter();
          this.showToast('Gaze position centered');
        }
      });
    },

    showHelpModal(show) {
      if (!this.helpModalEl) return;
      if (show) {
        this.helpModalEl.classList.add('open');
      } else {
        this.helpModalEl.classList.remove('open');
      }
    },

    toggleEyeTracking(enable) {
      this.isEyeTrackingEnabled = Boolean(enable);

      if (this.eyeToggleBtn) {
        if (this.isEyeTrackingEnabled) {
          this.eyeToggleBtn.classList.add('active');
        } else {
          this.eyeToggleBtn.classList.remove('active');
        }
      }

      try {
        localStorage.setItem('voice_nav_eyetracking', String(this.isEyeTrackingEnabled));
      } catch (e) {}

      if (this.isEyeTrackingEnabled) {
        EyeTracker.start(
          () => {
            this.showToast('Eye & Head Tracking active! Press Space to center.');
          },
          (err) => {
            this.showToast(`Camera error: ${err.message}`);
            this.toggleEyeTracking(false);
          }
        );
      } else {
        EyeTracker.stop();
        this.showToast('Eye tracking stopped');
      }
    },

    setButtonState(state) {
      if (!this.buttonEl) return;
      if (state === 'speaking') {
        this.buttonEl.className = 'listening';
        this.buttonEl.setAttribute('aria-pressed', 'true');
        this.buttonEl.setAttribute('aria-label', 'Voice Navigation: Listening actively');
      } else if (state === 'processing') {
        this.buttonEl.className = 'processing';
        this.buttonEl.setAttribute('aria-label', 'Voice Navigation: Processing audio');
      } else {
        this.buttonEl.className = '';
        this.buttonEl.setAttribute('aria-pressed', 'false');
        this.buttonEl.setAttribute('aria-label', 'Voice Navigation: Click to start');
      }
    },

    showToast(message, duration = 3000) {
      if (!this.toastEl) return;
      this.toastEl.textContent = message;
      this.toastEl.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        this.toastEl.classList.remove('show');
      }, duration);
    },

    async toggleListening() {
      if (this.isEnabled) {
        this.stopListening();
      } else {
        await this.startListening();
      }
    },

    async startListening() {
      this.isEnabled = true;
      this.setButtonState('speaking');
      this.showToast('Listening... Speak a command or "stop listening"');

      await AudioCapture.start(
        async (audioBlob) => {
          this.setButtonState('processing');
          this.showToast('Transcribing...');

          try {
            const transcript = await ApiClient.transcribe(audioBlob, this.language);

            if (HallucinationFilter.isHallucination(transcript)) {
              if (this.isEnabled) this.setButtonState('speaking');
              return;
            }

            await CommandParser.parseAndExecute(transcript, (statusText, spokenConfirmation, cb) => {
              this.showToast(statusText);
              if (spokenConfirmation) {
                ApiClient.speak(spokenConfirmation, () => {
                  if (cb) cb();
                  if (this.isEnabled) this.setButtonState('speaking');
                });
              } else {
                if (cb) cb();
                if (this.isEnabled) this.setButtonState('speaking');
              }
            });
          } catch (err) {
            this.showToast(`Error: ${err.message}`);
            if (this.isEnabled) this.setButtonState('speaking');
          }
        },
        (err) => {
          this.showToast(`Microphone error: ${err.message}`);
          this.stopListening();
        }
      );
    },

    stopListening() {
      this.isEnabled = false;
      this.setButtonState('idle');
      AudioCapture.stop();
      this.showToast('Voice navigation paused');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VoiceNavApp.init());
  } else {
    VoiceNavApp.init();
  }
})();
