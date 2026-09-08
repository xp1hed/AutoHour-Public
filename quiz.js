(() => {
  const { normalizeText, isVisible, isDisabled, setNativeInputValue } = globalThis.AutoHourUtils;
  const QUIZ_MODES = new Set(['homework-execution', 'homework-preview', 'practice']);
  const NEXT_LABELS = new Set(['다음', '다음 문제', 'next', 'continue', '계속', '확인', '제출 하기', '제출하기']);
  const EXCLUDED_LABELS = new Set(['정답확인', '다시 풀기', '나가기', 'exit', 'back', '뒤로']);
  const MAX_SELECTION_ATTEMPTS = 3;

  let quizState = null;
  let lastStateRequestAt = 0;
  let activeKey = '';
  let clickedKey = '';
  let nextAttemptAt = 0;
  let lastStatus = null;
  let quizDiagnostics = null;
  let lastDomKey = '';
  let feedbackAdvanceUntil = 0;
  let selectionAttempts = 0;
  // 팝업의 Target Answer는 상태 요청/피드백 전환 중에도 현재 문항의 검증된 정답을 표시해야함. 새 문항 DOM이 확인될 때만 초기화
  let lastTargetAnswer = '';

  function isQuizMode() {
    const params = new URLSearchParams(location.search);
    return QUIZ_MODES.has(params.get('mode')) || Boolean(params.get('quiz-id')) || /\/quiz\b|type=quiz|test_type=quiz/i.test(location.pathname + location.search);
  }

  function requestState() {
    const now = Date.now();
    if (now - lastStateRequestAt < 250) return;
    lastStateRequestAt = now;
    window.postMessage({ source: 'autohour-content', action: 'getQuizState' }, location.origin);
  }

  function getLabel(node) {
    return normalizeText(node.value || node.textContent || '');
  }

  function normalizeOptionText(value) {
    // React 데이터와 DOM은 번호, 유니코드 공백·구두점 표기가 다를수 있음
    // 보기 비교에만 사용, 절대 본문 정규화에 사용 금지!!
    return normalizeText(value)
      .replace(/^\s*(?:\d+|[a-z])\s*[.)]\s*/i, '')
      .replace(/^\s*[①②③④⑤]\s*/, '')
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[，、]/g, ',');
  }

  function getOptionLabel(node) {
    return normalizeOptionText(getLabel(node));
  }

  function isSelected(node) {
    const className = String(node.className || '').toLowerCase();
    const background = String(node.style?.backgroundColor || '').toLowerCase();
    return node.getAttribute('aria-checked') === 'true' ||
      node.getAttribute('aria-selected') === 'true' ||
      node.getAttribute('aria-pressed') === 'true' ||
      /(^|[-_ ])(selected|active|checked|chosen)([-_ ]|$)/.test(className) ||
      background.includes('yellow');
  }

  function getOptionNodes() {
    const answerSelector = '[data-dd-action="hw__hw_quiz__test"], .answer-button-container';
    const answerNodes = Array.from(document.querySelectorAll(answerSelector));
    // Quiz의 실제 정답 보기가 존재시 문제 본문이나 헤더가 섞일 수 있는 범용 선택 x
    const raw = answerNodes.length >= 2
      ? answerNodes
      : Array.from(document.querySelectorAll(
          'button, [role="button"], input[type="button"], input[type="submit"], [class*="quiz"], [class*="problem"]'
        ));
    const seen = new Set();
    const options = [];

    for (const node of raw) {
      if (!isVisible(node) || isDisabled(node)) continue;
      if (node.closest('header, nav, [class*="header"]')) continue;
      if (node.querySelectorAll('button, [role="button"]').length > 1) continue;
      const label = getOptionLabel(node);
      if (!label || label.length < 1 || label.length > 500 || EXCLUDED_LABELS.has(label) || NEXT_LABELS.has(label)) continue;
      const key = `${label}|${String(node.className || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(node);
    }
    return options;
  }

  function getCurrentProblem() {
    if (!quizState?.problems?.length) return null;
    return quizState.problems[quizState.currentIndex] || quizState.problems[0] || null;
  }

  function problemDebugState(problem, optionNodes = getOptionNodes()) {
    return {
      prompt: String(problem?.question || ''),
      options: optionNodes.map(getOptionLabel).filter(Boolean)
    };
  }

  function getDomSnapshot(optionNodes) {
    const prompt = normalizeText(
      Array.from(document.querySelectorAll('.problem-text-container [class*="problem_text"]'))
        .map((node) => node.textContent || '')
        .join(' ')
    );
    const options = optionNodes.map(getOptionLabel).filter(Boolean);
    const questionNumber = getVisibleQuestionNumber();
    return { prompt, options, questionNumber, key: `${questionNumber || '-'}|${prompt}|${options.join('|')}` };
  }

  function getVisibleQuestionNumber() {
    const nodes = document.querySelectorAll('.problem-text-container, [class*="problem_text"]');
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const text = String(node.textContent || '');
      const match = text.match(/^\s*(?:(?:q|question|문제)\s*(\d+)\b|(\d+)\s*(?:[.)]|번\b))/i);
      if (match) return Number(match[1] || match[2]);
    }
    return null;
  }

  function matchesCurrentDom(problem, snapshot) {
    const expectedOptions = (problem.answers || []).map((answer) => normalizeOptionText(answer.text || ''));
    const orderedOptionsMatch = expectedOptions.length === snapshot.options.length &&
      expectedOptions.every((answer, index) => answer === snapshot.options[index]);
    const remainingOptions = [...snapshot.options];
    const optionsMatch = expectedOptions.length === remainingOptions.length &&
      expectedOptions.every((answer) => {
        const index = remainingOptions.indexOf(answer);
        if (index < 0) return false;
        remainingOptions.splice(index, 1);
        return true;
      });
    const expectedPrompt = normalizeText(String(problem.question || '').replace(/<[^>]*>/g, ' '));
    const promptMatch = !expectedPrompt || !snapshot.prompt ||
      snapshot.prompt.includes(expectedPrompt) || expectedPrompt.includes(snapshot.prompt);
    return {
      matches: optionsMatch && promptMatch,
      optionsMatch,
      orderedOptionsMatch,
      promptMatch,
      expectedOptions,
      domOptions: snapshot.options
    };
  }

  function findNextButton() {
    return Array.from(document.querySelectorAll('button, [role="button"], [class*="next"], [class*="nav-btn"]'))
      .find((node) => isVisible(node) && !isDisabled(node) &&
        (NEXT_LABELS.has(getLabel(node)) || NEXT_LABELS.has(normalizeText(node.textContent))));
  }

  function findQuizTextInput() {
    return Array.from(document.querySelectorAll('.problem-text-container input[type="text"], .problem-text-container textarea, input[type="text"], textarea'))
      .find((node) => isVisible(node) && !isDisabled(node));
  }

  function findQuizSubmitButton() {
    return Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .find((node) => isVisible(node) && !isDisabled(node) &&
        ['확인', '제출', '제출하기', '정답확인', 'check', 'submit'].includes(getLabel(node)));
  }

  function fillQuizTextAnswer(problem, debug) {
    const answer = (problem.answers || []).find((item) => item.isCorrect);
    if (!answer?.text) return { status: 'waiting_for_verified_quiz_answer', lastAction: 'no_correct_answer', ...debug };
    const input = findQuizTextInput();
    if (!input) return { status: 'waiting_for_quiz_text_input', targetWord: answer.text, lastAction: 'waiting_for_text_input', ...debug };
    const key = `${problem.id}|short|${normalizeOptionText(answer.text)}`;
    if (clickedKey === key) {
      return { status: 'waiting_for_quiz_feedback', targetWord: answer.text, lastAction: 'awaiting_text_grade', ...debug };
    }
    if (!setNativeInputValue(input, answer.text)) {
      return { status: 'unsupported_quiz_short_input', targetWord: answer.text, lastAction: 'missing_native_input_setter', ...debug };
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const submit = findQuizSubmitButton();
    if (!submit) return { status: 'waiting_for_quiz_submit', targetWord: answer.text, lastAction: 'typed_quiz_answer', ...debug };
    clickedKey = key;
    nextAttemptAt = Date.now() + 850;
    submit.click();
    return { status: 'quiz_submitting_answer', targetWord: answer.text, lastAction: 'submit:short', ...debug };
  }

  function advanceNoneQuiz(problem, debug) {
    const key = `${problem.id}|none`;
    if (clickedKey === key) return { status: 'waiting_for_quiz_advance', lastAction: 'awaiting_none_advance', ...debug };
    const next = findNextButton() || findQuizSubmitButton();
    if (!next) return { status: 'waiting_for_quiz_advance', lastAction: 'waiting_for_none_advance_button', ...debug };
    clickedKey = key;
    nextAttemptAt = Date.now() + 850;
    next.click();
    return { status: 'quiz_advancing_none', lastAction: 'click:none_advance', ...debug };
  }

  function findFeedbackNextButton() {
    // QuizAIFeedback 구조: .feedback-container 내부의 "다음" 버튼
    const modalRoots = Array.from(document.querySelectorAll('[class*="feedback-container"], [role="dialog"]'));
    for (const root of modalRoots) {
      if (!isVisible(root)) continue;
      const next = Array.from(root.querySelectorAll('button, [role="button"]')).find((node) =>
        isVisible(node) && !isDisabled(node) && NEXT_LABELS.has(getLabel(node))
      );
      if (next) return next;
    }
    return null;
  }

  function clickQuizOption(node) {
    // div에 React onClick 핸들러를 연결, click()만으로 처리되지 않는 렌더 시점에도 동일한 버블링 클릭 이벤트를 전달
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function setStatus(status) {
    if (status === lastStatus) return null;
    lastStatus = status;
    return status;
  }

  function tick({ enabled }) {
    if (!isQuizMode()) {
      quizState = null;
      activeKey = '';
      clickedKey = '';
      selectionAttempts = 0;
      lastDomKey = '';
      lastTargetAnswer = '';
      return null;
    }
    if (!enabled) return { status: 'disabled', lastAction: 'quiz_disabled' };

    // Choice/Multi 답을 고르면 원아워는 해설을 뛰움
    // 이때 즉시 다음으로 전환 필요
    const feedbackNextButton = findFeedbackNextButton();
    if (feedbackNextButton) {
      nextAttemptAt = Date.now() + 900;
      feedbackAdvanceUntil = Date.now() + 800;
      clickedKey = '';
      selectionAttempts = 0;
      activeKey = '';
      quizState = null;
      lastDomKey = '';
      feedbackNextButton.click();
      return {
        status: 'quiz_feedback_next',
        targetWord: lastTargetAnswer,
        lastAction: 'click:feedback_next'
      };
    }

    if (Date.now() < feedbackAdvanceUntil) {
      requestState();
      return {
        status: 'waiting_for_quiz_transition',
        targetWord: lastTargetAnswer,
        lastAction: 'waiting_after_feedback_next'
      };
    }

    const optionNodes = getOptionNodes();
    const domSnapshot = getDomSnapshot(optionNodes);
    if (domSnapshot.key !== lastDomKey) {
      // 새 DOM에서 이전 응답을 절대 재사용 금지
      lastDomKey = domSnapshot.key;
      quizState = null;
      activeKey = '';
      clickedKey = '';
      selectionAttempts = 0;
      lastTargetAnswer = '';
      nextAttemptAt = Date.now() + 350;
    }
    requestState();

    const problem = getCurrentProblem();
    if (!problem) {
      return {
        status: 'waiting_for_quiz_state',
        targetWord: lastTargetAnswer,
        lastAction: 'requesting_quiz_state',
        diagnostic: quizDiagnostics
      };
    }
    const debug = problemDebugState(problem, optionNodes);
    const category = normalizeText(problem.category);
    if (category === 'short') return fillQuizTextAnswer(problem, debug);
    if (category === 'none') return advanceNoneQuiz(problem, debug);
    if (!['choice', 'multi'].includes(category)) {
      return { status: `unsupported_quiz_${category || 'unknown'}`, lastAction: 'unsupported_category', ...debug };
    }

    const domMatch = matchesCurrentDom(problem, domSnapshot);
    if (!domMatch.matches) {
      quizState = null;
      return {
        status: 'waiting_for_current_quiz_state',
        targetWord: lastTargetAnswer,
        lastAction: 'discarding_stale_quiz_state',
        diagnostic: {
          ...(quizDiagnostics || {}),
          domOptionCount: domSnapshot.options.length,
          expectedOptionCount: problem.answers.length,
          optionsMatch: domMatch.optionsMatch,
          promptMatch: domMatch.promptMatch,
          expectedOptionLabels: domMatch.expectedOptions,
          domOptionLabels: domMatch.domOptions
        }
      };
    }

    const correctAnswers = problem.answers.filter((answer) => answer.isCorrect);
    if (!correctAnswers.length) return { status: 'waiting_for_verified_quiz_answer', lastAction: 'no_correct_answer', ...debug };

    // 보기 순서까지 일치할 때만 index로 연결
    //  보기를 섞어 랜더시 텍스트 기반 매핑으로 전환, 오류 방지
    const hasPositionalAnswerMap = domMatch.orderedOptionsMatch && optionNodes.length === problem.answers.length &&
      problem.answers.every((answer, index) => answer.index === index);
    const optionMap = new Map(optionNodes.map((node) => [getOptionLabel(node), node]));
    const targetNodes = hasPositionalAnswerMap
      ? correctAnswers.map((answer) => optionNodes[answer.index]).filter(Boolean)
      : correctAnswers.map((answer) => optionMap.get(normalizeOptionText(answer.text))).filter(Boolean);
    const key = `${problem.id}|${problem.category}|${correctAnswers.map((answer) => normalizeOptionText(answer.text)).join('|')}`;
    const targetText = correctAnswers.map((answer) => answer.text).join(', ');
    lastTargetAnswer = targetText;

    if (activeKey !== key) {
      activeKey = key;
      clickedKey = '';
      selectionAttempts = 0;
      nextAttemptAt = Date.now() + 800;
    }
    if (Date.now() < nextAttemptAt) {
      return {
        status: 'waiting_for_quiz_ready',
        targetWord: targetText,
        lastAction: 'settling_after_question_change',
        ...debug
      };
    }
    if (targetNodes.length !== correctAnswers.length) {
      return {
        status: 'waiting_for_quiz_options',
        targetWord: targetText,
        lastAction: hasPositionalAnswerMap ? 'waiting_for_answer_index_match' : 'waiting_for_exact_option_match',
        ...debug
      };
    }

    if (clickedKey !== key) {
      if (selectionAttempts >= MAX_SELECTION_ATTEMPTS) {
        return {
          status: 'quiz_selection_failed',
          targetWord: targetText,
          lastAction: 'selection_retry_limit',
          ...debug
        };
      }
      selectionAttempts += 1;
      clickedKey = key;
      nextAttemptAt = Date.now() + 1200;
      targetNodes.forEach(clickQuizOption);
      return {
        status: 'quiz_selecting_answers',
        targetWord: targetText,
        lastAction: `select:${category}`,
        ...debug
      };
    }

    if (Date.now() < nextAttemptAt) return { status: 'waiting_for_quiz_feedback', targetWord: targetText, lastAction: 'awaiting_grade', ...debug };
    const nextButton = findNextButton();
    if (nextButton) {
      nextAttemptAt = Date.now() + 900;
      nextButton.click();
      return { status: 'quiz_next', targetWord: targetText, lastAction: 'click:next', ...debug };
    }

    return { status: setStatus('quiz_selection_unverified') || 'quiz_selection_unverified', targetWord: targetText, lastAction: 'awaiting_quiz_feedback_or_advance', ...debug };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === 'autohour-page' && event.data.action === 'quizState') {
      quizState = event.data.state;
      quizDiagnostics = event.data.diagnostics || event.data.state?.diagnostics || null;
    }
  });

  window.AutoHourQuizSolver = { isQuizMode, tick };
})();
