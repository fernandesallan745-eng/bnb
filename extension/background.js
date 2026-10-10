const DEFAULT_SERVER_URL = 'http://localhost:3001';

async function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['voice_nav_server_url'], (res) => {
      resolve((res && res.voice_nav_server_url) || DEFAULT_SERVER_URL);
    });
  });
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

function bufferToDataUrl(arrayBuffer, mimeType) {
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'VOICE_NAV_TRANSCRIBE') {
    handleTranscribe(request, sendResponse);
    return true;
  }

  if (request.type === 'VOICE_NAV_SPEAK') {
    handleSpeak(request, sendResponse);
    return true;
  }

  if (request.type === 'VOICE_NAV_INTENT') {
    handleIntent(request, sendResponse);
    return true;
  }
});

async function handleTranscribe(request, sendResponse) {
  try {
    const serverUrl = await getServerUrl();
    const audioBlob = dataUrlToBlob(request.dataUrl);

    const formData = new FormData();
    formData.append('audio', audioBlob, 'speech.webm');
    if (request.language && request.language !== 'auto') {
      formData.append('language', request.language);
    }

    const response = await fetch(`${serverUrl}/transcribe`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      return sendResponse({ error: `Transcription failed: ${response.status} ${errText}` });
    }

    const data = await response.json();
    sendResponse({ text: data.text || '' });
  } catch (err) {
    sendResponse({ error: err.message || 'Network error during transcription' });
  }
}

async function handleSpeak(request, sendResponse) {
  try {
    const serverUrl = await getServerUrl();
    const response = await fetch(`${serverUrl}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: request.text })
    });

    if (!response.ok) {
      const errText = await response.text();
      return sendResponse({ error: `Speech synthesis failed: ${response.status} ${errText}` });
    }

    const arrayBuffer = await response.arrayBuffer();
    const dataUrl = bufferToDataUrl(arrayBuffer, 'audio/mpeg');
    sendResponse({ dataUrl });
  } catch (err) {
    sendResponse({ error: err.message || 'Network error during speech synthesis' });
  }
}

async function handleIntent(request, sendResponse) {
  try {
    const serverUrl = await getServerUrl();
    const response = await fetch(`${serverUrl}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: request.transcript,
        elements: request.elements
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return sendResponse({ error: `Intent resolution failed: ${response.status} ${errText}` });
    }

    const data = await response.json();
    sendResponse(data);
  } catch (err) {
    sendResponse({ error: err.message || 'Network error resolving intent' });
  }
}
