document.addEventListener('DOMContentLoaded', () => {
  const enableToggle = document.getElementById('enable-toggle');
  const eyeToggle = document.getElementById('eye-toggle');
  const langSelect = document.getElementById('lang-select');
  const serverUrlInput = document.getElementById('server-url-input');
  const statusBadge = document.getElementById('status-badge');
  const newPhraseInput = document.getElementById('new-phrase');
  const newActionSelect = document.getElementById('new-action');
  const addCmdBtn = document.getElementById('add-cmd-btn');
  const commandsList = document.getElementById('commands-list');

  let state = {
    enabled: false,
    eyetracking: false,
    language: 'en',
    serverUrl: 'http://localhost:3001',
    customCommands: {}
  };

  chrome.storage.sync.get(
    [
      'voice_nav_enabled',
      'voice_nav_eyetracking',
      'voice_nav_language',
      'voice_nav_server_url',
      'voice_nav_custom_commands'
    ],
    (res) => {
      if (res) {
        state.enabled = Boolean(res.voice_nav_enabled);
        state.eyetracking = Boolean(res.voice_nav_eyetracking);
        state.language = res.voice_nav_language || 'en';
        state.serverUrl = res.voice_nav_server_url || 'http://localhost:3001';
        state.customCommands = res.voice_nav_custom_commands || {};
      }
      applyStateToUI();
    }
  );

  function applyStateToUI() {
    enableToggle.checked = state.enabled;
    eyeToggle.checked = state.eyetracking;
    langSelect.value = state.language;
    serverUrlInput.value = state.serverUrl;

    if (state.enabled || state.eyetracking) {
      statusBadge.textContent = 'Active';
      statusBadge.className = 'status-badge active';
    } else {
      statusBadge.textContent = 'Idle';
      statusBadge.className = 'status-badge';
    }

    renderCommandsList();
  }

  function renderCommandsList() {
    commandsList.innerHTML = '';
    const entries = Object.entries(state.customCommands);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = '#64748b';
      empty.style.fontSize = '11px';
      empty.style.padding = '4px 0';
      empty.textContent = 'No custom commands defined yet.';
      commandsList.appendChild(empty);
      return;
    }

    entries.forEach(([phrase, action]) => {
      const item = document.createElement('div');
      item.className = 'command-item';

      const textWrap = document.createElement('div');
      const phraseSpan = document.createElement('span');
      phraseSpan.className = 'command-phrase';
      phraseSpan.textContent = `"${phrase}"`;

      const actionSpan = document.createElement('span');
      actionSpan.className = 'command-action';
      actionSpan.textContent = `→ ${action}`;

      textWrap.appendChild(phraseSpan);
      textWrap.appendChild(actionSpan);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-del';
      delBtn.textContent = '✕';
      delBtn.setAttribute('title', 'Remove command');
      delBtn.addEventListener('click', () => {
        delete state.customCommands[phrase];
        saveAndBroadcast();
        renderCommandsList();
      });

      item.appendChild(textWrap);
      item.appendChild(delBtn);
      commandsList.appendChild(item);
    });
  }

  function saveAndBroadcast() {
    chrome.storage.sync.set({
      voice_nav_enabled: state.enabled,
      voice_nav_eyetracking: state.eyetracking,
      voice_nav_language: state.language,
      voice_nav_server_url: state.serverUrl,
      voice_nav_custom_commands: state.customCommands
    });

    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id && !tab.url?.startsWith('chrome://')) {
          chrome.tabs.sendMessage(
            tab.id,
            {
              type: 'VOICE_NAV_SETTINGS_UPDATED',
              enabled: state.enabled,
              eyetracking: state.eyetracking,
              language: state.language,
              customCommands: state.customCommands
            },
            () => {
              if (chrome.runtime.lastError) {}
            }
          );
        }
      });
    });
  }

  enableToggle.addEventListener('change', (e) => {
    state.enabled = e.target.checked;
    applyStateToUI();
    saveAndBroadcast();
  });

  eyeToggle.addEventListener('change', (e) => {
    state.eyetracking = e.target.checked;
    applyStateToUI();
    saveAndBroadcast();
  });

  langSelect.addEventListener('change', (e) => {
    state.language = e.target.value;
    saveAndBroadcast();
  });

  serverUrlInput.addEventListener('change', (e) => {
    state.serverUrl = e.target.value.trim() || 'http://localhost:3001';
    saveAndBroadcast();
  });

  addCmdBtn.addEventListener('click', () => {
    const phrase = newPhraseInput.value.trim().toLowerCase();
    const action = newActionSelect.value;

    if (!phrase) return;

    state.customCommands[phrase] = action;
    newPhraseInput.value = '';
    renderCommandsList();
    saveAndBroadcast();
  });
});
