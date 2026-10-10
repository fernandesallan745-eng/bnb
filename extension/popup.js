// Handsfree Extension Popup Logic
document.addEventListener("DOMContentLoaded", () => {
  const masterSwitch = document.getElementById("master-switch");
  const statusBadge = document.getElementById("status-badge");
  const modeButtons = document.querySelectorAll(".mode-btn");
  const dwellSlider = document.getElementById("dwell-slider");
  const dwellVal = document.getElementById("dwell-val");
  const sensSlider = document.getElementById("sens-slider");
  const sensVal = document.getElementById("sens-val");
  const soundCheckbox = document.getElementById("sound-checkbox");
  const guardCheckbox = document.getElementById("guard-checkbox");
  const openTrackerBtn = document.getElementById("open-tracker-btn");
  const toggleNumbersBtn = document.getElementById("toggle-numbers-btn");

  let currentSettings = {
    enabled: false,
    mode: "hybrid",
    dwellTimeMs: 1200,
    sensitivity: 1.4,
    soundFeedback: true,
    accidentalGuard: true,
  };

  // Fetch initial state
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
    if (res?.state) {
      currentSettings = { ...currentSettings, ...res.state };
      applyStateToUI();
    }
  });

  function applyStateToUI() {
    masterSwitch.checked = currentSettings.enabled;
    if (currentSettings.enabled) {
      statusBadge.textContent = "Active";
      statusBadge.className = "status-badge active";
    } else {
      statusBadge.textContent = "Off";
      statusBadge.className = "status-badge";
    }

    modeButtons.forEach((btn) => {
      if (btn.dataset.mode === currentSettings.mode) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    dwellSlider.value = currentSettings.dwellTimeMs;
    dwellVal.textContent = `${(currentSettings.dwellTimeMs / 1000).toFixed(1)}s`;

    sensSlider.value = currentSettings.sensitivity;
    sensVal.textContent = `${currentSettings.sensitivity.toFixed(1)}x`;

    soundCheckbox.checked = currentSettings.soundFeedback !== false;
    guardCheckbox.checked = currentSettings.accidentalGuard !== false;
  }

  function updateSettings(delta) {
    currentSettings = { ...currentSettings, ...delta };
    chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      payload: delta,
    });
    applyStateToUI();
  }

  // Event Listeners
  masterSwitch.addEventListener("change", (e) => {
    chrome.runtime.sendMessage({
      type: "TOGGLE_HANDSFREE",
      payload: e.target.checked,
    }, (res) => {
      if (res?.state) {
        currentSettings = { ...currentSettings, ...res.state };
        applyStateToUI();
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      updateSettings({ mode: btn.dataset.mode });
    });
  });

  dwellSlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    dwellVal.textContent = `${(val / 1000).toFixed(1)}s`;
    updateSettings({ dwellTimeMs: val });
  });

  sensSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    sensVal.textContent = `${val.toFixed(1)}x`;
    updateSettings({ sensitivity: val });
  });

  soundCheckbox.addEventListener("change", (e) => {
    updateSettings({ soundFeedback: e.target.checked });
  });

  guardCheckbox.addEventListener("change", (e) => {
    updateSettings({ accidentalGuard: e.target.checked });
  });

  openTrackerBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "TOGGLE_HANDSFREE",
      payload: true,
    });
  });

  toggleNumbersBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "HANDSFREE_ACTION",
          action: "SHOW_NUMBERS",
        });
      }
    });
  });
});
