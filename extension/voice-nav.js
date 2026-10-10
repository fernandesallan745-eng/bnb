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
        if (el.closest('#voice-nav-root')) {
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
    language: 'en',
    buttonEl: null,
    toastEl: null,

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
      } catch (e) {}

      if (ApiClient.isExtension) {
        try {
          chrome.storage.sync.get(['voice_nav_enabled', 'voice_nav_language', 'voice_nav_custom_commands'], (res) => {
            if (res) {
              if (typeof res.voice_nav_enabled === 'boolean') {
                if (res.voice_nav_enabled && !this.isEnabled) {
                  this.startListening();
                } else if (!res.voice_nav_enabled && this.isEnabled) {
                  this.stopListening();
                }
              }
              if (res.voice_nav_language) {
                this.language = res.voice_nav_language;
              }
              if (res.voice_nav_custom_commands) {
                CommandParser.saveCustomCommands(res.voice_nav_custom_commands);
              }
            }
          });
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
        #voice-nav-btn {
          position: fixed;
          bottom: 24px;
          right: 24px;
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
          z-index: 2147483647;
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
        #voice-nav-toast {
          position: fixed;
          bottom: 92px;
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

      container.appendChild(style);
      container.appendChild(toast);
      container.appendChild(btn);
      document.body.appendChild(container);

      this.buttonEl = btn;
      this.toastEl = toast;

      btn.addEventListener('click', () => {
        this.toggleListening();
      });

      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'v' || e.key === 'V')) {
          e.preventDefault();
          this.toggleListening();
        }
      });
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
