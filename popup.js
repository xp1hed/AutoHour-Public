const STORAGE_KEY = 'autohour.enabled';
const DEBUG_KEY = 'autohour.debug';
const LOGS_KEY = 'autohour.logs';
const UA_COMPATIBILITY_KEY = 'autohour.uaCompatibility';
const LOG_SETTINGS_KEY = 'autohour.logSettings';
const LANGUAGE_KEY = 'autohour.language';

const toggleButton = document.getElementById('toggle');
const statusNode = document.getElementById('status');
const processStatusNode = document.getElementById('process-status');
const promptNode = document.getElementById('prompt');
const optionsNode = document.getElementById('options');
const targetWordNode = document.getElementById('target-word');
const logsNode = document.getElementById('logs');
const logsContentNode = document.getElementById('logs-content');
const toggleLogsButton = document.getElementById('toggle-logs');
const exportLogsButton = document.getElementById('export-logs');
const clearLogsButton = document.getElementById('clear-logs');
const logsCountNode = document.getElementById('logs-count');
const googleChromeUaNode = document.getElementById('google-chrome-ua');
const webappUaNode = document.getElementById('webapp-ua');
const openSettingsButton = document.getElementById('open-settings');
const compatibilityPanel = document.getElementById('settings-panel');
const autoSaveLogsNode = document.getElementById('auto-save-logs');
const logLimitNode = document.getElementById('log-limit');
const languageNode = document.getElementById('popup-language');
let isSupportedPage = false;
let activeLanguage = 'en';

function t(key, variables) {
  return window.AutoHourTranslations.translate(activeLanguage, key, variables);
}

function applyTranslations() {
  document.documentElement.lang = activeLanguage;
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  });
}

function is1HourUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === '1hour.ai' || parsed.hostname.endsWith('.1hour.ai'));
  } catch {
    return false;
  }
}

function syncUi(enabled) {
  const state = isSupportedPage ? (enabled ? 'enabled' : 'disabled') : 'unavailable';
  statusNode.textContent = isSupportedPage ? (enabled ? t('statusEnabled') : t('statusDisabled')) : t('statusUnavailable');
  statusNode.className = `status status-${state}`;
  toggleButton.textContent = enabled ? t('disableSolver') : t('enableSolver');
  toggleButton.disabled = !isSupportedPage;
}

function renderLanguage(value) {
  activeLanguage = window.AutoHourTranslations.normalizeLanguage(value);
  languageNode.value = activeLanguage;
  applyTranslations();
}

function normalizeUaCompatibility(value) {
  return {
    googleChrome: value?.googleChrome !== false,
    webapp: value?.webapp === true
  };
}

function renderUaCompatibility(value) {
  const settings = normalizeUaCompatibility(value);
  googleChromeUaNode.checked = settings.googleChrome;
  webappUaNode.checked = settings.webapp;
}

function normalizeLogSettings(value) {
  const limit = Number(value?.maxEntries);
  return {
    autoSave: value?.autoSave !== false,
    maxEntries: [100, 250, 500, 1000].includes(limit) ? limit : 500
  };
}

function renderLogSettings(value) {
  const settings = normalizeLogSettings(value);
  autoSaveLogsNode.checked = settings.autoSave;
  logLimitNode.value = String(settings.maxEntries);
  logLimitNode.disabled = !settings.autoSave;
}

function getLogTone(message) {
  const text = String(message || '').toLowerCase();
  if (/error|fail|오류|오답|실패/.test(text)) return 'error';
  if (/waiting|request|scan|찾|대기|확인 중/.test(text)) return 'progress';
  return 'success';
}

function renderState(state, logs = []) {
  const payload = state || {};
  processStatusNode.textContent = payload.status || 'idle';
  promptNode.textContent = payload.prompt || '-';
  targetWordNode.textContent = payload.targetWord || '-';

  const optionList = Array.isArray(payload.options) && payload.options.length ? payload.options : ['-'];
  optionsNode.innerHTML = '';
  optionList.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    optionsNode.appendChild(li);
  });

  const legacyLogs = Array.isArray(payload.logs) ? payload.logs : [];
  // 저장소에 빈 배열이 있을시 로그를 비운 상태임
  const savedLogs = Array.isArray(logs) ? logs : legacyLogs;
  logsCountNode.textContent = t('logsCount', { count: savedLogs.length });
  const logList = savedLogs.length ? savedLogs : [{ stamp: '—', message: t('noLogs') }];
  logsNode.innerHTML = '';
  logList.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'log-entry';

    const stamp = document.createElement('time');
    stamp.className = 'log-stamp';
    stamp.textContent = entry.stamp || '—';

    const marker = document.createElement('span');
    marker.className = `log-marker ${getLogTone(entry.message)}`;
    marker.setAttribute('aria-hidden', 'true');

    const message = document.createElement('span');
    message.className = 'log-message';
    message.textContent = entry.message;

    li.append(stamp, marker, message);
    logsNode.appendChild(li);
  });
}

function refreshState() {
  chrome.storage.local.get([STORAGE_KEY, DEBUG_KEY, LOGS_KEY, UA_COMPATIBILITY_KEY, LOG_SETTINGS_KEY, LANGUAGE_KEY], (result) => {
    renderLanguage(result[LANGUAGE_KEY]);
    const enabled = result[STORAGE_KEY] === true;
    syncUi(enabled);
    renderState(result[DEBUG_KEY] || {}, result[LOGS_KEY]);
    renderUaCompatibility(result[UA_COMPATIBILITY_KEY]);
    renderLogSettings(result[LOG_SETTINGS_KEY]);
  });
}

chrome.storage.local.get([STORAGE_KEY, DEBUG_KEY, LOGS_KEY, UA_COMPATIBILITY_KEY, LOG_SETTINGS_KEY, LANGUAGE_KEY], (result) => {
  renderLanguage(result[LANGUAGE_KEY]);
  const enabled = result[STORAGE_KEY] === true;
  syncUi(enabled);
  renderState(result[DEBUG_KEY] || {}, result[LOGS_KEY]);
  renderUaCompatibility(result[UA_COMPATIBILITY_KEY]);
  renderLogSettings(result[LOG_SETTINGS_KEY]);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEY] || changes[DEBUG_KEY] || changes[LOGS_KEY] || changes[UA_COMPATIBILITY_KEY] || changes[LOG_SETTINGS_KEY] || changes[LANGUAGE_KEY]) {
    refreshState();
  }
});

function saveUaCompatibility() {
  const settings = normalizeUaCompatibility({
    googleChrome: googleChromeUaNode.checked,
    webapp: webappUaNode.checked
  });

  chrome.runtime.sendMessage({ action: 'setUaCompatibility', settings }, () => {
    if (chrome.runtime.lastError || !isSupportedPage) return;
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (typeof tabId !== 'number') return;
      chrome.tabs.sendMessage(tabId, { action: 'setUaCompatibilitySettings', settings }, () => {
        chrome.tabs.reload(tabId);
      });
    });
  });
}

googleChromeUaNode.addEventListener('change', saveUaCompatibility);
webappUaNode.addEventListener('change', saveUaCompatibility);

function saveLogSettings() {
  const settings = normalizeLogSettings({
    autoSave: autoSaveLogsNode.checked,
    maxEntries: Number(logLimitNode.value)
  });
  chrome.runtime.sendMessage({ action: 'setLogSettings', settings });
}

autoSaveLogsNode.addEventListener('change', saveLogSettings);
logLimitNode.addEventListener('change', saveLogSettings);

languageNode.addEventListener('change', () => {
  const language = window.AutoHourTranslations.normalizeLanguage(languageNode.value);
  chrome.storage.local.set({ [LANGUAGE_KEY]: language }, () => {
    activeLanguage = language;
    applyTranslations();
    refreshState();
  });
});

openSettingsButton.addEventListener('click', () => {
  const willShow = compatibilityPanel.hidden;
  compatibilityPanel.hidden = !willShow;
  openSettingsButton.setAttribute('aria-expanded', String(willShow));
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || compatibilityPanel.hidden) return;
  compatibilityPanel.hidden = true;
  openSettingsButton.setAttribute('aria-expanded', 'false');
  openSettingsButton.focus();
});

toggleButton.addEventListener('click', () => {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (!isSupportedPage) return;
    const nextEnabled = result[STORAGE_KEY] === true ? false : true;
    chrome.storage.local.set({ [STORAGE_KEY]: nextEnabled }, () => {
      syncUi(nextEnabled);
      refreshState();
    });
  });
});

toggleLogsButton.addEventListener('click', () => {
  const willShow = logsContentNode.hidden;
  logsContentNode.hidden = !willShow;
  toggleLogsButton.setAttribute('aria-expanded', String(willShow));
});

exportLogsButton.addEventListener('click', () => {
  chrome.storage.local.get([LOGS_KEY, DEBUG_KEY], (result) => {
    const entries = Array.isArray(result[LOGS_KEY]) && result[LOGS_KEY].length
      ? result[LOGS_KEY]
      : (Array.isArray(result[DEBUG_KEY]?.logs) ? result[DEBUG_KEY].logs : []);
    const exportData = {
      exportedAt: new Date().toISOString(),
      entries
    };
    const blob = new Blob([`${JSON.stringify(exportData, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `autohour-logs-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
});

clearLogsButton.addEventListener('click', () => {
  chrome.storage.local.get([DEBUG_KEY], (result) => {
    const debugState = { ...(result[DEBUG_KEY] || {}), logs: [] };
    chrome.storage.local.set({ [LOGS_KEY]: [], [DEBUG_KEY]: debugState }, () => {
      if (chrome.runtime.lastError) return;
      renderState(debugState, []);
    });
  });
});

chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
  isSupportedPage = is1HourUrl(tabs[0]?.url || '');
  refreshState();
});

// 여러 문항이 자동 전환 돠어도 2초마다 최신처리
setInterval(refreshState, 2000);


document.addEventListener("DOMContentLoaded", () => {
  const manifestData = chrome.runtime.getManifest();
  document.getElementById("version").textContent = manifestData.version;
});
