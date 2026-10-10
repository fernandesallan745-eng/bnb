// Handsfree Chrome Extension - Background Service Worker (Manifest V3)
let state = {
  enabled: false,
  mode: "hybrid", // "hybrid" | "head" | "hand" | "voice"
  dwellTimeMs: 1200,
  sensitivity: 1.4,
  smoothing: 0.75,
  showNumbers: false,
  soundFeedback: true,
  accidentalGuard: true,
  trackerWindowId: null,
};

// Initialize state from chrome.storage.local
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["handsfree_settings"], (res) => {
    if (res.handsfree_settings) {
      state = { ...state, ...res.handsfree_settings };
    } else {
      chrome.storage.local.set({ handsfree_settings: state });
    }
  });
});

// Broadcast state change to all tabs
async function broadcastToTabs(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith("chrome://")) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // tab might not have content script yet or is sleeping
        });
      }
    }
  } catch (err) {
    console.error("Broadcast error:", err);
  }
}

// Send message to active tab
async function sendToActiveTab(message) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id) {
      chrome.tabs.sendMessage(activeTab.id, message).catch(() => {});
    }
  } catch (err) {
    console.error("Send to active tab error:", err);
  }
}

// Message Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Query State
  if (request.type === "GET_STATE") {
    sendResponse({ state });
    return true;
  }

  // 2. Update Settings
  if (request.type === "UPDATE_SETTINGS") {
    state = { ...state, ...request.payload };
    chrome.storage.local.set({ handsfree_settings: state });
    broadcastToTabs({ type: "HANDSFREE_STATE_CHANGED", state });
    sendResponse({ success: true, state });
    return true;
  }

  // 3. Toggle Handsfree On / Off
  if (request.type === "TOGGLE_HANDSFREE") {
    state.enabled = request.payload !== undefined ? request.payload : !state.enabled;
    chrome.storage.local.set({ handsfree_settings: state });
    broadcastToTabs({ type: "HANDSFREE_STATE_CHANGED", state });

    if (state.enabled) {
      openTrackerWindow();
    } else {
      closeTrackerWindow();
    }

    sendResponse({ success: true, state });
    return true;
  }

  // 3b. Explicit Open Tracker Action
  if (request.type === "OPEN_TRACKER") {
    state.enabled = true;
    chrome.storage.local.set({ handsfree_settings: state });
    broadcastToTabs({ type: "HANDSFREE_STATE_CHANGED", state });
    openTrackerWindow();
    sendResponse({ success: true, state });
    return true;
  }

  // 4. Coordinates / Telemetry from Tracker Window -> Active Tab
  if (request.type === "TRACKER_CURSOR_UPDATE") {
    if (state.enabled) {
      sendToActiveTab({
        type: "HANDSFREE_CURSOR_UPDATE",
        payload: request.payload, // { x, y, source: "head"|"hand", confidence }
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  // 5. Action from Tracker (Click, Scroll, Voice Command, Type)
  if (request.type === "TRACKER_ACTION") {
    if (state.enabled) {
      sendToActiveTab({
        type: "HANDSFREE_ACTION",
        action: request.action,
        payload: request.payload,
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  // 6. Navigation Actions (Back, Forward, Reload, Tab)
  if (request.type === "NAVIGATE_PAGE") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      if (request.action === "back") chrome.tabs.goBack(tab.id);
      if (request.action === "forward") chrome.tabs.goForward(tab.id);
      if (request.action === "reload") chrome.tabs.reload(tab.id);
    });
    sendResponse({ ok: true });
    return true;
  }
});

// Track when tracker window is closed by user
chrome.windows?.onRemoved?.addListener((winId) => {
  if (winId === state.trackerWindowId) {
    state.trackerWindowId = null;
  }
});

// Helper: Open tracker window (compact floating companion window with webcam & mic)
async function openTrackerWindow() {
  const trackerUrl = chrome.runtime.getURL("tracker.html");

  if (state.trackerWindowId) {
    try {
      const existing = await chrome.windows.get(state.trackerWindowId);
      if (existing) {
        await chrome.windows.update(state.trackerWindowId, {
          focused: true,
          drawAttention: true,
        });
        return;
      }
    } catch {
      state.trackerWindowId = null;
    }
  }

  try {
    chrome.windows.create(
      {
        url: trackerUrl,
        type: "popup",
        width: 400,
        height: 540,
        left: 40,
        top: 60,
        focused: true,
      },
      (win) => {
        if (chrome.runtime.lastError || !win) {
          console.warn("Could not create popup window, opening in tab instead:", chrome.runtime.lastError);
          chrome.tabs.create({ url: trackerUrl, active: true });
        } else {
          state.trackerWindowId = win.id;
        }
      },
    );
  } catch (err) {
    console.warn("chrome.windows.create threw error, falling back to tab:", err);
    chrome.tabs.create({ url: trackerUrl, active: true });
  }
}

function closeTrackerWindow() {
  if (state.trackerWindowId) {
    chrome.windows.remove(state.trackerWindowId).catch(() => {});
    state.trackerWindowId = null;
  }
}
