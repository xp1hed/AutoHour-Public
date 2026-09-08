const SETTING_KEY = 'autohour.enabled';
const LOGS_KEY = 'autohour.logs';
const UA_COMPATIBILITY_KEY = 'autohour.uaCompatibility';
const LOG_SETTINGS_KEY = 'autohour.logSettings';
const UA_RULE_ID = 1001;

function is1HourUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === '1hour.ai' || parsed.hostname.endsWith('.1hour.ai'));
  } catch {
    return false;
  }
}

function updateActionForTab(tabId, url) {
  if (typeof tabId !== 'number') return;
  if (is1HourUrl(url)) chrome.action.enable(tabId);
  else chrome.action.disable(tabId);
}

function normalizeUaCompatibility(value) {
  return {
    googleChrome: value?.googleChrome !== false,
    webapp: value?.webapp === true
  };
}

function normalizeLogSettings(value) {
  const maxEntries = Number(value?.maxEntries);
  return {
    autoSave: value?.autoSave !== false,
    maxEntries: [100, 250, 500, 1000].includes(maxEntries) ? maxEntries : 500
  };
}

function trimSavedLogs(maxEntries, callback = () => {}) {
  chrome.storage.local.get([LOGS_KEY], (result) => {
    const logs = Array.isArray(result[LOGS_KEY]) ? result[LOGS_KEY] : [];
    const trimmed = logs.slice(0, maxEntries);
    if (trimmed.length === logs.length) {
      callback();
      return;
    }
    chrome.storage.local.set({ [LOGS_KEY]: trimmed }, callback);
  });
}

function updateUaRequestRule(settings, callback = () => {}) {
  const api = chrome.declarativeNetRequest;
  if (!api?.updateDynamicRules) {
    callback();
    return;
  }

  const rule = {
    id: UA_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'user-agent', operation: 'append', value: '1hour_webapp' }]
    },
    condition: { urlFilter: '||1hour.ai/' }
  };
  api.updateDynamicRules({
    removeRuleIds: [UA_RULE_ID],
    addRules: normalizeUaCompatibility(settings).webapp ? [rule] : []
  }, callback);
}

function initializeUaCompatibility() {
  chrome.storage.local.get([UA_COMPATIBILITY_KEY], (result) => {
    const settings = normalizeUaCompatibility(result[UA_COMPATIBILITY_KEY]);
    chrome.storage.local.set({ [UA_COMPATIBILITY_KEY]: settings }, () => updateUaRequestRule(settings));
  });
}

function initializeLogSettings() {
  chrome.storage.local.get([LOG_SETTINGS_KEY], (result) => {
    const settings = normalizeLogSettings(result[LOG_SETTINGS_KEY]);
    chrome.storage.local.set({ [LOG_SETTINGS_KEY]: settings }, () => trimSavedLogs(settings.maxEntries));
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([SETTING_KEY], (result) => {
    // 처음 설치시 명시적으로 비활성화
    if (typeof result[SETTING_KEY] !== 'boolean') {
      chrome.storage.local.set({ [SETTING_KEY]: false });
    }
  });
  initializeUaCompatibility();
  initializeLogSettings();
  chrome.tabs.query({}, (tabs) => tabs.forEach((tab) => updateActionForTab(tab.id, tab.url)));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') updateActionForTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => updateActionForTab(tabId, tab?.url));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.query({}, (tabs) => tabs.forEach((tab) => updateActionForTab(tab.id, tab.url)));
  initializeUaCompatibility();
  initializeLogSettings();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[UA_COMPATIBILITY_KEY]) {
    updateUaRequestRule(changes[UA_COMPATIBILITY_KEY].newValue);
  }
  if (areaName === 'local' && changes[LOG_SETTINGS_KEY]) {
    trimSavedLogs(normalizeLogSettings(changes[LOG_SETTINGS_KEY].newValue).maxEntries);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setUaCompatibility') {
    const settings = normalizeUaCompatibility(message.settings);
    chrome.storage.local.set({ [UA_COMPATIBILITY_KEY]: settings }, () => {
      updateUaRequestRule(settings, () => sendResponse({ success: !chrome.runtime.lastError }));
    });
    return true;
  }

  if (message.action === 'setLogSettings') {
    const settings = normalizeLogSettings(message.settings);
    chrome.storage.local.set({ [LOG_SETTINGS_KEY]: settings }, () => {
      trimSavedLogs(settings.maxEntries, () => sendResponse({ success: !chrome.runtime.lastError }));
    });
    return true;
  }

  if (message.action === 'appendLog') {
    const entry = message.entry;
    if (!entry || typeof entry.message !== 'string') {
      sendResponse({ success: false });
      return;
    }

    chrome.storage.local.get([LOGS_KEY, LOG_SETTINGS_KEY], (result) => {
      const settings = normalizeLogSettings(result[LOG_SETTINGS_KEY]);
      if (!settings.autoSave) {
        sendResponse({ success: true, skipped: true });
        return;
      }
      const previous = Array.isArray(result[LOGS_KEY]) ? result[LOGS_KEY] : [];
      const next = [{
        stamp: String(entry.stamp || ''),
        message: entry.message,
        createdAt: Number(entry.createdAt) || Date.now()
      }, ...previous].slice(0, settings.maxEntries);
      chrome.storage.local.set({ [LOGS_KEY]: next }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Log storage error:', chrome.runtime.lastError);
          sendResponse({ success: false });
          return;
        }
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.action === 'setDebugState') {
    chrome.storage.local.set({ [message.key]: message.value }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Storage error:', chrome.runtime.lastError);
      }
      sendResponse({ success: true });
    });
    return true; // 비동기 응답 전송
  }

  if (message.action === 'getDebugState') {
    chrome.storage.local.get([message.key], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('Storage error:', chrome.runtime.lastError);
        sendResponse({ success: false, data: null });
      } else {
        sendResponse({ success: true, data: result[message.key] || null });
      }
    });
    return true;
  }

  if (message.action === 'getSetting') {
    chrome.storage.local.get([SETTING_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('Storage error:', chrome.runtime.lastError);
        sendResponse({ success: false, value: false });
      } else {
        sendResponse({ success: true, value: result[SETTING_KEY] === true });
      }
    });
    return true;
  }
});
