(() => {
  const { normalizeText, isVisible, isDisabled, getNodeLabel, setNativeInputValue } = globalThis.AutoHourUtils;
  const STORAGE_KEY = 'autohour.enabled';
  const DEBUG_KEY = 'autohour.debug';

  const ROOT_SELECTOR = '.assignment-word-test, [class*="assignment-word-test"]';
  const QUESTION_TEXT_SELECTOR = '.assignment-word-test__word, [class*="assignment-word-test__word"], .assignment-word-test__content__wrap, [class*="assignment-word-test__content__wrap"]';
  const OPTION_SELECTORS = [
    '.assignment-word-test-choice_answer',
    '.assignment-word-test-choice',
    '[class*="assignment-word-test-choice"]',
    '[class*="assignment-word-test__answer"]',
    'button[class*="choice"]',
    'button[data-dd-action*="word-choice"]',
    'button[data-dd-action*="word_choice"]',
    'button[data-dd-action*="quiz"]',
    '[data-dd-action*="choice"]',
    '[class*="quiz"] button',
    '[class*="option"]',
    '[class*="answer"]',
    '[class*="choice"]',
    '[class*="option-button"]',
    '[role="button"]',
    '[class*="assignment-word-test__input"] button:not([class*="next"]):not([class*="continue"])'
  ];
  const REVIEW_MODE = new URLSearchParams(location.search).get('isReview') === 'true';
  const IS_QUIZ_PAGE = /\/quiz\b|type=quiz|quiz-id=/.test(location.pathname + location.search);

  // 설정을 읽기 전에는 동작x
  let enabled = false;
  let currentQuestionKey = '';
  let lastClickedQuestionKey = '';
  let questionDetectedAt = 0;
  let attemptIndex = 0;
  let isProcessing = false;
  let appWordState = null;
  let lastStateRequestAt = 0;
  let extensionContextActive = true;
  let observer = null;
  let settingTimerId = null;
  let solverTimerId = null;
  let lastQuizLogKey = '';
  let lastDebugState = {
    enabled: false,
    status: 'idle',
    prompt: '',
    options: [],
    targetWord: '',
    lastAction: 'waiting',
    lastFeedback: 'none',
    logs: []
  };

  function stopForInvalidExtensionContext() {
    if (!extensionContextActive) return;
    extensionContextActive = false;
    if (observer) observer.disconnect();
    if (settingTimerId) clearInterval(settingTimerId);
    if (solverTimerId) clearInterval(solverTimerId);
  }

  function isExtensionContextAvailable() {
    try {
      const available = extensionContextActive && typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
      if (!available) stopForInvalidExtensionContext();
      return available;
    } catch (e) {
      stopForInvalidExtensionContext();
      return false;
    }
  }

  function sendRuntimeMessage(message, onResponse) {
    if (!isExtensionContextAvailable()) return;

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (!isExtensionContextAvailable()) return;
        onResponse?.(response);
      });
    } catch (e) {
      if (String(e).includes('Extension context invalidated')) {
        stopForInvalidExtensionContext();
        return;
      }
      console.warn('Failed to send extension message:', e);
    }
  }

  function loadSetting() {
    sendRuntimeMessage({ action: 'getSetting' }, (response) => {
      if (response?.success) {
        applySetting(response.value);
      }
    });
  }

  function applySetting(nextEnabled) {
    const changed = enabled !== nextEnabled;
    enabled = nextEnabled;
    if (!changed) return;

    if (!enabled) {
      setDebugState({ status: 'disabled', lastAction: 'disabled' });
      return;
    }
    tickSolver();
  }

  function normalizeLearningAnswer(value) {
    return String(value || '')
      .replace(/[^\uac00-\ud7a3a-zA-Z\u3040-\u30FF\u4E00-\u9FFF]/g, '')
      .toLowerCase();
  }

  function pushLog(message) {
    const stamp = new Date().toTimeString().slice(0, 8);
    const log = { stamp, message, createdAt: Date.now() };
    const previousLogs = Array.isArray(lastDebugState.logs) ? lastDebugState.logs : [];
    lastDebugState.logs = [log, ...previousLogs].slice(0, 12);

    sendRuntimeMessage({ action: 'appendLog', entry: log });

    sendRuntimeMessage({
      action: 'setDebugState',
      key: DEBUG_KEY,
      value: { ...lastDebugState, enabled }
    });
  }

  function setDebugState(partial) {
    lastDebugState = { ...lastDebugState, ...partial };
    if (!Array.isArray(lastDebugState.logs)) {
      lastDebugState.logs = [];
    }

    sendRuntimeMessage({
      action: 'setDebugState',
      key: DEBUG_KEY,
      value: { ...lastDebugState, enabled }
    });
  }

  function getQuestionRoot() {
    const roots = document.querySelectorAll(ROOT_SELECTOR);
    for (const root of roots) {
      if (root && root.isConnected && root.offsetParent !== null) {
        return root;
      }
    }

    if (REVIEW_MODE || IS_QUIZ_PAGE) {
      if (getReviewOptionButtons().length >= 2 || document.querySelectorAll('button, [role="button"]').length >= 2) {
        return document.body;
      }
    }

    return null;
  }

  function getReviewOptionButtons() {
    return Array.from(document.querySelectorAll('button, [role="button"]')).filter((node) => {
      if (!isVisible(node) || isDisabled(node)) return false;
      const label = getNodeLabel(node);
      return label.length >= 2 && label.length <= 80 && /[a-z]/i.test(label) && !/^(next|continue|exit|back)$/.test(label);
    });
  }

  function getReviewPromptText() {
    const options = getReviewOptionButtons();
    if (options.length < 2) return '';

    const optionTop = Math.min(...options.map((node) => node.getBoundingClientRect().top));
    const optionLabels = new Set(options.map(getNodeLabel));
    const candidates = Array.from(document.querySelectorAll('h1, h2, h3, p, div, span'))
      .filter((node) => {
        if (!isVisible(node) || node.querySelector('button, [role="button"]')) return false;
        const rect = node.getBoundingClientRect();
        const text = normalizeText(node.textContent);
        return rect.bottom <= optionTop && text.length >= 2 && text.length <= 160 && !optionLabels.has(text);
      })
      .map((node) => {
        const text = normalizeText(node.textContent);
        const fontSize = Number.parseFloat(getComputedStyle(node).fontSize) || 0;
        return { text, score: fontSize * 1000 + text.length };
      })
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.text || '';
  }

  function getPromptText() {
    const root = getQuestionRoot();
    if (!root) return '';

    if (REVIEW_MODE) {
      const reviewPrompt = getReviewPromptText();
      if (reviewPrompt) return reviewPrompt;
    }

    for (const selector of QUESTION_TEXT_SELECTOR.split(',').map((s) => s.trim())) {
      const el = root.querySelector(selector);
      if (!el) continue;
      const text = normalizeText(el.textContent);
      if (text && !['단어 고르기', 'word choice', ''].includes(text)) {
        return text;
      }
    } // 링딩동 들으면서 하고있는데 왜 인도노래 같냐

    return normalizeText(root.textContent).slice(0, 120);
  }

  function getVisibleOptions() {
    const root = getQuestionRoot();
    if (!root) return [];

    const raw = [];
    for (const selector of OPTION_SELECTORS) {
      raw.push(...Array.from(root.querySelectorAll(selector)));
    }
    if (REVIEW_MODE || IS_QUIZ_PAGE) {
      raw.push(...getReviewOptionButtons());
      raw.push(...Array.from(root.querySelectorAll('button, [role="button"], [class*="option"], [class*="choice"]')));
    }

    const seen = new Set();
    const result = [];

    for (const node of raw) {
      if (!node || !node.isConnected || !node.offsetParent) continue;

      // 가장 작은 텍스트 콘텐츠 추출
      let label = '';

      if (node.value) {
        label = normalizeText(node.value);
      } else if (node.textContent) {
        // 베이베~
        for (const child of node.childNodes) {
          if (child.nodeType === 3) { // TEXT_NODE
            const text = normalizeText(child.textContent);
            if (text) {
              label = text;
              break;
            }
          }
        }
        if (!label) {
          label = normalizeText(node.textContent);
        }
      }

      if (!label || label.length < 2) continue;

      // 제외 목록
      if (['정답확인', '다음', '다시 풀기', '입력', '무음모드', 'off', 'on', '보기'].includes(label)) continue;
      if (node.closest('[class*="assignment-word-test__header"]')) continue;

      // 부모 컨테이너 제거
      const childButtons = node.querySelectorAll('button, [role="button"]');
      if (childButtons.length > 1) {
        continue;
      }

      // clickable 요소만
      const className = typeof node.className === 'string' ? node.className : '';
      const isClickable =
        node.tagName === 'BUTTON' ||
        node.tagName === 'INPUT' ||
        node.role === 'button' ||
        className.includes('btn') ||
        className.includes('choice') ||
        node.onclick ||
        node.style?.cursor === 'pointer';

      if (!isClickable) {
        continue;
      }

      const key = `${label}|${className}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(node);
    }

    const prompt = getPromptText();
    const normalizedPrompt = normalizeText(prompt);
    const nonPromptOptions = normalizedPrompt
      ? result.filter((node) => getNodeLabel(node) !== normalizedPrompt)
      : result;
    return nonPromptOptions.length >= 2 ? nonPromptOptions : result;
  }

  function hasAnswerFeedback() {
    const root = getQuestionRoot();
    if (!root) return false;

    const nodes = root.querySelectorAll('[class*="assignment-word-test__input"]');
    for (const node of nodes) {
      const className = String(node.className || '');
      if (className.includes('correct') || className.includes('wrong')) {
        return true;
      }
    }
    return false;
  }

  function getFeedbackState() {
    const root = getQuestionRoot();
    if (!root) return 'none';

    const nodes = root.querySelectorAll('[class*="assignment-word-test__input"]');
    for (const node of nodes) {
      const className = String(node.className || '');
      if (className.includes('correct')) return 'correct';
      if (className.includes('wrong')) return 'wrong';
    }
    return 'none';
  }

  function findNextButton() {
    const root = getQuestionRoot();
    if (!root) return null;

    const candidates = Array.from(root.querySelectorAll('button, [role="button"], [class*="next"], [class*="continue"]'));
    for (const node of candidates) {
      if (!node || !node.isConnected || !node.offsetParent) continue;
      const label = getNodeLabel(node);
      if (['다음', 'next', 'continue', '계속'].includes(label)) {
        return node;
      }
    }
    return null;
  }

  function findAppWordState() {
    requestAppWordState();
    return appWordState;
  }

  function requestAppWordState() {
    const now = Date.now();
    if (now - lastStateRequestAt < 300) return;
    lastStateRequestAt = now;
    window.postMessage({ source: 'autohour-content', action: 'getWordState' }, location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source === 'autohour-page' && data.action === 'wordState') {
      appWordState = data.state;
      // 비동기 브리지 응답을 받으면 다음 500ms 폴링을 기다리지 않고 즉시 재평가
      if (enabled) tickSolver();
    }
  });

  function evaluateCorrectOption() {
    const appState = findAppWordState();
    const optionNodes = getVisibleOptions();
    const prompt = getPromptText();

    if (!optionNodes || optionNodes.length === 0) {
      return null;
    }

    const targetOptions = optionNodes;
    if (!appState || !prompt) return null;

    const normalizedPrompt = normalizeLearningAnswer(prompt);
    const isEnglishPrompt = /[a-z]/i.test(normalizedPrompt) && !/[가-힣]/.test(normalizedPrompt);

    const verifiedCandidates = (appState.choices || [])
      .map((choice) => {
        const question = normalizeLearningAnswer(choice.question || choice.prompt || choice.text || choice.title || '');
        const normalizedQuestion = normalizeLearningAnswer(choice.questionNormalized || question);
        const rawAnswer = choice.answer || choice.value || choice.correct || '';
        const answer = normalizeLearningAnswer(rawAnswer);
        if ((question !== normalizedPrompt && normalizedQuestion !== normalizedPrompt) || !answer || answer === normalizedPrompt) {
          return null;
        }
        // 느슨한 정규화 문제, 해결 해야함
        const exactAnswer = normalizeText(rawAnswer);
        const exactMatches = targetOptions.filter((node) => getNodeLabel(node) === exactAnswer);
        const normalizedMatches = targetOptions.filter((node) => normalizeLearningAnswer(getNodeLabel(node)) === answer);
        if (exactMatches.length > 1) return null;
        const option = exactMatches[0] || (normalizedMatches.length === 1 ? normalizedMatches[0] : null);
        if (!option) return null;

        const score = (isEnglishPrompt && /[가-힣]/.test(answer) ? 10 : 0) + (/[가-힣]/.test(answer) ? 1 : 0);
        return { option, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return verifiedCandidates[0]?.option || null;
  }

  function tryFillTextAnswer() {
    const appState = findAppWordState();
    if (!appState?.choices?.length) return false;

    const root = getQuestionRoot();
    if (!root) return false;

    const input = root.querySelector('input[type="text"], textarea, input:not([type]), [contenteditable="true"]');
    if (!input) return false;

    const prompt = getPromptText();
    const normalizedPrompt = normalizeLearningAnswer(prompt);
    const match = appState.choices.find((choice) =>
      normalizeLearningAnswer(choice.question || choice.prompt || '') === normalizedPrompt
    );
    const answerText = match ? String(match.answer || match.value || '') : '';
    if (!answerText) return false;

    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      input.focus();
      if (!setNativeInputValue(input, answerText)) return false;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const submit = Array.from(root.querySelectorAll('button, [role="button"], input[type="submit"]'))
        .find((node) => isVisible(node) && !isDisabled(node) &&
          ['확인', '제출', '제출하기', '정답확인', 'check', 'submit'].includes(getNodeLabel(node)));
      if (submit) submit.click();
      return { answerText, submitted: Boolean(submit) };
    }

    if (input.isContentEditable) {
      input.textContent = answerText;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const submit = Array.from(root.querySelectorAll('button, [role="button"], input[type="submit"]'))
        .find((node) => isVisible(node) && !isDisabled(node) &&
          ['확인', '제출', '제출하기', '정답확인', 'check', 'submit'].includes(getNodeLabel(node)));
      if (submit) submit.click();
      return { answerText, submitted: Boolean(submit) };
    }

    return false;
  }

  function questionKey() {
    const prompt = getPromptText();
    const options = getVisibleOptions();
    const labels = options.map(getNodeLabel).slice(0, 8).join('|');
    return `${prompt}|${labels}`;
  }

  function resetTurn() {
    attemptIndex = 0;
    isProcessing = false;
  }

  function clickNextVisibleChoice() {
    if (!enabled || isProcessing) return;

    const root = getQuestionRoot();
    if (!root) return;

    const options = getVisibleOptions();
    if (!options.length) {
      setDebugState({ status: 'waiting_for_options', prompt: getPromptText(), options: [], targetWord: '', lastAction: 'scan' });
      return;
    }

    const optionLabels = options.map(getNodeLabel);

    const candidate = evaluateCorrectOption();
    if (!candidate) {
      const textFilled = tryFillTextAnswer();
      if (textFilled) {
        isProcessing = true;
        lastClickedQuestionKey = questionKey();
        setDebugState({
          status: textFilled.submitted ? 'typing_and_submitting_answer' : 'typing_answer',
          prompt: getPromptText(),
          options: optionLabels,
          targetWord: textFilled.answerText,
          lastAction: textFilled.submitted ? 'typing_and_submitting_answer' : 'typing_answer'
        });
        pushLog(textFilled.submitted ? 'typed and submitted answer via text input' : 'typed answer via text input');
        setTimeout(() => {
          resetTurn();
          currentQuestionKey = questionKey();
        }, 700);
        return;
      }

      setDebugState({
        status: 'waiting_for_verified_answer',
        prompt: getPromptText(),
        options: optionLabels,
        targetWord: '',
        lastAction: 'waiting_for_exact_match'
      });
      return;
    }

    const label = getNodeLabel(candidate);

    if (isDisabled(candidate)) {
      setDebugState({
        status: 'waiting_for_enabled_option',
        prompt: getPromptText(),
        options: optionLabels,
        targetWord: label,
        lastAction: 'option_disabled'
      });
      return;
    }

    pushLog(`matched options: ${optionLabels.slice(0, 4).join(', ')}`);
    if (label) {
      pushLog(`selected target: ${label}`);
    }

    setDebugState({
      status: 'clicking_option',
      prompt: getPromptText(),
      options: optionLabels,
      targetWord: label,
      lastAction: `click:${label}`
    });
    pushLog(`click target: ${label}`);

    isProcessing = true;
    lastClickedQuestionKey = questionKey();
    candidate.click();

    setTimeout(() => {
      const feedback = getFeedbackState();
      const nextButton = findNextButton();
      setDebugState({
        status: feedback === 'none' ? 'waiting_for_feedback' : 'answer_feedback',
        prompt: getPromptText(),
        options: optionLabels,
        targetWord: label,
        lastAction: `after_click:${feedback || 'waiting'}`,
        lastFeedback: feedback
      });

      if (feedback !== 'none') {
        pushLog(`feedback detected: ${feedback}`);
        resetTurn();
        currentQuestionKey = questionKey();
        return;
      }

      if (nextButton) {
        const nextLabel = getNodeLabel(nextButton);
        setDebugState({
          status: 'next_question',
          prompt: getPromptText(),
          options: optionLabels,
          targetWord: label,
          lastAction: `next:${nextLabel}`,
          lastFeedback: 'none'
        });
        pushLog(`next button: ${nextLabel}`);
        nextButton.click();
        setTimeout(() => {
          resetTurn();
          currentQuestionKey = questionKey();
        }, 350);
        return;
      }

      isProcessing = false;
    }, 500);
  }

  function tickSolver() {
    if (!isExtensionContextAvailable()) return;

    const isFlashcardMode = window.AutoHourFlashcardSolver?.isFlashcardMode();
    const isQuizMode = window.AutoHourQuizSolver?.isQuizMode();
    const isSentenceMode = window.AutoHourSentenceSolver?.isSentenceMode();
    const isWatchMode = window.AutoHourWatchSolver?.isWatchMode();

    if (!enabled) {
      if (isFlashcardMode) {
        setDebugState({ status: 'disabled', prompt: '', options: [], targetWord: '', lastAction: 'flashcard_disabled' });
      } else if (isQuizMode) {
        setDebugState({ status: 'disabled', prompt: '', options: [], targetWord: '', lastAction: 'quiz_disabled' });
      } else if (isSentenceMode) {
        setDebugState({ status: 'disabled', prompt: '', options: [], targetWord: '', lastAction: 'sentence_disabled' });
      } else if (isWatchMode) {
        setDebugState({ status: 'disabled', prompt: '', options: [], targetWord: '', lastAction: 'watch_disabled' });
      } else {
        const options = getVisibleOptions();
        setDebugState({ status: 'disabled', prompt: getPromptText(), options: options.map(getNodeLabel), targetWord: '', lastAction: 'disabled' });
      }
      return;
    }

    if (isFlashcardMode) {
      const flashcardState = window.AutoHourFlashcardSolver.tick({ enabled });
      if (flashcardState) {
        setDebugState({
          status: flashcardState.status,
          prompt: '',
          options: [],
          targetWord: flashcardState.targetWord || '',
          lastAction: flashcardState.lastAction || 'flashcard_scan'
        });
        if (flashcardState.lastAction === 'click:know') {
          pushLog('flashcard: selected know');
        }
      }
      return;
    }

    if (isQuizMode) {
      const quizSolverState = window.AutoHourQuizSolver.tick({ enabled });
      if (quizSolverState) {
        setDebugState({
          status: quizSolverState.status,
          prompt: quizSolverState.prompt || '',
          options: quizSolverState.options || [],
          targetWord: quizSolverState.targetWord || '',
          lastAction: quizSolverState.lastAction || 'quiz_scan'
        });
        const diagnostic = quizSolverState.diagnostic;
        const diagnosticText = diagnostic
          ? `source=${diagnostic.source || 'unknown'}, candidates=${diagnostic.candidateCount ?? 0}, score=${diagnostic.answerMatchScore ?? 0}, index=${diagnostic.currentIndex ?? -1}/${diagnostic.problemCount ?? 0}, domOptions=${diagnostic.domOptionCount ?? diagnostic.domAnswerNodeCount ?? '-'}, expectedOptions=${diagnostic.expectedOptionCount ?? '-'}, optionsMatch=${diagnostic.optionsMatch ?? '-'}, promptMatch=${diagnostic.promptMatch ?? '-'}${diagnostic.optionsMatch === false ? `, domLabels=${JSON.stringify(diagnostic.domOptionLabels || [])}, expectedLabels=${JSON.stringify(diagnostic.expectedOptionLabels || [])}` : ''}`
          : '';
        const quizLogKey = `${quizSolverState.status}|${quizSolverState.lastAction}|${diagnosticText}`;
        if (quizLogKey !== lastQuizLogKey) {
          lastQuizLogKey = quizLogKey;
          pushLog(`quiz: ${quizSolverState.lastAction}${diagnosticText ? ` (${diagnosticText})` : ''}`);
        }
      }
      return;
    }

    if (isSentenceMode) {
      const sentenceSolverState = window.AutoHourSentenceSolver.tick({ enabled });
      if (sentenceSolverState) {
        setDebugState({
          status: sentenceSolverState.status,
          prompt: '',
          options: [],
          targetWord: sentenceSolverState.targetWord || '',
          lastAction: sentenceSolverState.lastAction || 'sentence_scan'
        });
      }
      return;
    }

    if (isWatchMode) {
      const watchSolverState = window.AutoHourWatchSolver.tick({ enabled });
      if (watchSolverState) {
        setDebugState({
          status: watchSolverState.status,
          prompt: '',
          options: [],
          targetWord: '',
          lastAction: watchSolverState.lastAction || 'watch_scan'
        });
      }
      return;
    }

    const root = getQuestionRoot();
    if (!root) {
      setDebugState({ status: 'waiting_for_question', prompt: '', options: [], targetWord: '', lastAction: 'scan' });
      return;
    }

    const prompt = getPromptText();
    const options = getVisibleOptions();
    const optionLabels = options.map(getNodeLabel);
    const key = `${prompt}|${optionLabels.slice(0, 8).join('|')}`;

    if (!key || key.length < 4) {
      setDebugState({ status: 'question_detected_waiting_for_options', prompt, options: optionLabels, targetWord: '', lastAction: 'scan' });
      return;
    }

    if (currentQuestionKey !== key) {
      currentQuestionKey = key;
      lastClickedQuestionKey = '';
      questionDetectedAt = Date.now();
      resetTurn();
      setDebugState({ status: 'question_detected', prompt, options: optionLabels, targetWord: '', lastAction: 'new_question' });
      pushLog(`new question: ${prompt}`);
    }

    // 서버 로직에 맞춤 딜레이 시간 ^^ 링딩동링딩동
    if (Date.now() - questionDetectedAt < 800) {
      setDebugState({ status: 'waiting_for_page_ready', prompt, options: optionLabels, targetWord: '', lastAction: 'settling_after_question_change' });
      return;
    }

    if (lastClickedQuestionKey === key) {
      setDebugState({ status: 'waiting_for_feedback', prompt, options: optionLabels, targetWord: lastDebugState.targetWord, lastAction: 'awaiting_answer_result' });
      return;
    }

    if (!isProcessing && !hasAnswerFeedback()) {
      clickNextVisibleChoice();
    }
  }

  loadSetting();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    applySetting(changes[STORAGE_KEY].newValue === true);
  });

  // 주기적 상태 확인
  settingTimerId = setInterval(loadSetting, 1500);

  observer = new MutationObserver(() => {
    if (!document.body) return;
    tickSolver();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'data-word']
  });

  solverTimerId = setInterval(tickSolver, 500);
})();
