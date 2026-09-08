// English / 한국어 번역본
// 작업해주신 래미님께 감사드립니다!
window.AutoHourTranslations = (() => {
  const messages = {
    en: {
      title: 'AutoHour',
      subtitle: '1hour solver',
      statusEnabled: 'Enabled',
      statusDisabled: 'Disabled',
      statusUnavailable: 'Available only on 1hour.ai',
      enableSolver: 'Enable Auto Solver',
      disableSolver: 'Disable Auto Solver',
      settings: 'Settings',
      language: 'Language',
      displayLanguage: 'Display Language',
      displayLanguageHelp: 'Choose the language',
      korean: '한국어',
      english: 'English',
      compatibility: 'Browser Compatibility',
      googleChrome: 'Google Chrome',
      googleChromeHelp: 'Recognize Android Kiwi as Chrome',
      webapp: '1hour_webapp',
      webappHelp: 'Add the 1hour web app identifier',
      logs: 'Logs',
      autoSaveLogs: 'Auto Save Logs',
      autoSaveLogsHelp: 'Save logs to extension storage',
      keepLogs: 'Keep Logs',
      keepLogsHelp: 'Automatically delete older logs',
      processStatus: 'Process Status',
      currentQuestion: 'Current Question',
      recognizedAnswer: 'Recognized Answer',
      targetAnswer: 'Target Answer',
      downloadLogs: 'Download Logs',
      clearLogs: 'Clear Logs',
      noLogs: 'no logs',
      logsCount: '{count} logs'
    },
    ko: {
      title: 'AutoHour',
      subtitle: '1hour solver',
      statusEnabled: 'Enabled',
      statusDisabled: 'Disabled',
      statusUnavailable: '1hour.ai 에서만 사용 가능합니다.',
      enableSolver: 'Enable Auto Solver',
      disableSolver: 'Disable Auto Solver',
      settings: '설정',
      language: '언어',
      displayLanguage: '표시 언어',
      displayLanguageHelp: '표시할 언어를 선택합니다',
      korean: '한국어',
      english: 'English',
      compatibility: '브라우저 호환성',
      googleChrome: 'Google Chrome',
      googleChromeHelp: 'Android Kiwi를 Chrome으로 변경합니다.',
      webapp: '1hour_webapp',
      webappHelp: '웹앱 식별자를 추가합니다.',
      logs: '로그',
      autoSaveLogs: '로그 자동 저장',
      autoSaveLogsHelp: '로그를 자동으로 저장합니다.',
      keepLogs: '로그 보관 개수',
      keepLogsHelp: '저장할 로그 개수를 설정합니다.',
      processStatus: '진행 상태',
      currentQuestion: '현재 질문',
      recognizedAnswer: '인식한 문항',
      targetAnswer: '목표 정답',
      downloadLogs: '로그 저장',
      clearLogs: '로그 지우기',
      noLogs: '로그 없음',
      logsCount: '{count}개'
    }
  };

  function normalizeLanguage(language) {
    return language === 'ko' ? 'ko' : 'en';
  }

  function translate(language, key, variables = {}) {
    const text = messages[normalizeLanguage(language)]?.[key] || messages.en[key] || key;
    return text.replace(/\{(\w+)\}/g, (_match, name) => String(variables[name] ?? ''));
  }

  return { normalizeLanguage, translate };
})();
