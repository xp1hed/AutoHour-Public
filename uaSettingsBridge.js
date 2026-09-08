(() => {
  'use strict';

  const SETTINGS_KEY = 'autohour.ua-settings';
  const STORAGE_KEY = 'autohour.uaCompatibility';
  const DEFAULT_SETTINGS = { googleChrome: true, webapp: false };

  function normalizeSettings(value) {
    return {
      googleChrome: value?.googleChrome !== false,
      webapp: value?.webapp === true
    };
  }

  function saveToPage(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
      return true;
    } catch {
      return false;
    }
  }

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    saveToPage(result[STORAGE_KEY] || DEFAULT_SETTINGS);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== 'setUaCompatibilitySettings') return;
    sendResponse({ success: saveToPage(message.settings) });
  });
})();
