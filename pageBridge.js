(() => {
  const WORD_CHOICE_SELECTOR = '[data-dd-action*="word-choice"], [data-dd-action*="word_choice"]';

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // 숫자·공백·문장부호를 제거 및 한글/영문/가나/한자 남김
  function normalizeLearningText(value) {
    return String(value || '')
      .replace(/[^\uac00-\ud7a3a-zA-Z\u3040-\u30FF\u4E00-\u9FFF]/g, '')
      .toLowerCase();
  }

  function resolveAnswerWord(entry, wordList) {
    if (!Array.isArray(wordList)) return null;
    if (entry && typeof entry === 'object') return entry;

    const index = Number(entry);
    if (Number.isInteger(index) && wordList[index]) return wordList[index];

    return (
      wordList.find((word) => String(word?.id) === String(entry)) ||
      wordList.find((word) => String(word?.word) === String(entry)) ||
      wordList.find((word) => String(word?.value) === String(entry)) ||
      null
    );
  }

  function toChoiceRecord(question, answer) {
    const q = normalizeLearningText(question);
    const a = normalizeLearningText(answer);
    if (!q || !a) return null;
    // 브리지 밖으론 문자열만 전달
    return { question: String(question), answer: String(answer), questionNormalized: q, answerNormalized: a };
  }

  function appendUniqueChoice(list, choice) {
    if (!choice) return;
    const key = `${normalizeLearningText(choice.question)}|${normalizeLearningText(choice.answer)}`;
    if (!list.some((item) => `${normalizeLearningText(item.question)}|${normalizeLearningText(item.answer)}` === key)) {
      list.push(choice);
    }
  }

  function extractWordChoices(wordList, answerList) {
    if (!Array.isArray(wordList) || !Array.isArray(answerList)) return [];

    const choices = [];
    for (const entry of answerList) {
      const word = resolveAnswerWord(entry, wordList);
      if (!word || typeof word !== 'object') continue;

      const wordText = word.word || word.value || word.label || '';
      const definition = word.definitions?.[0]?.definition || word.meaning || word.definition || '';
      if (!wordText || !definition) continue;

      appendUniqueChoice(choices, toChoiceRecord(definition, wordText));
      appendUniqueChoice(choices, toChoiceRecord(wordText, definition));
    }

    return choices;
  }

  function extractGenericChoices(props, fallbackAssignment) {
    const choices = [];
    // 일반 선택형 데이터에서 확인된 choices·choiceList·options만 다룸 나머지는 별도 로직에서 처리
    const sources = [
      props?.choices,
      props?.choiceList,
      props?.options,
      fallbackAssignment?.choices,
      fallbackAssignment?.choiceList,
      fallbackAssignment?.options
    ];
    const fallbackSources = [
      props?.answerOptions,
      props?.items,
      props?.question?.choices,
      props?.currentQuestion?.choices,
      props?.quiz?.choices,
      props?.quizList,
      props?.quiz_list,
      fallbackAssignment?.quizList,
      fallbackAssignment?.quiz_list,
      props?.currentQuizList,
      props?.questionSet,
      props?.questionList,
      fallbackAssignment?.answerOptions
    ];

    const collectSource = (source) => {
      if (!Array.isArray(source)) return;

      for (const item of source) {
        if (!item) continue;

        if (typeof item === 'string') continue;

        if (typeof item === 'object') {
          const question = item.question || item.prompt || item.text || item.label || item.title || item.content || item.statement || item.word || item.sentence || '';
          const answer = item.answer || item.value || item.correct || item.option || item.choice || item.word || item.label || item.solution || item.correctAnswer || item.answerText || '';
          if (question && answer) appendUniqueChoice(choices, toChoiceRecord(question, answer));

          const options = item.options || item.answers || item.answerList || item.choiceList || item.choices;
          if (Array.isArray(options)) {
            for (const option of options) {
              if (typeof option === 'string') appendUniqueChoice(choices, toChoiceRecord(question, option));
              else if (option && (option.answer || option.value || option.correct || option.text || option.label)) {
                const optionQuestion = question || option.question || option.prompt || option.text || option.label || '';
                const optionAnswer = option.answer || option.value || option.correct || option.text || option.label || option.word || option.solution || '';
                if (optionQuestion && optionAnswer) appendUniqueChoice(choices, toChoiceRecord(optionQuestion, optionAnswer));
              }
            }
          }
        }
      }
    };

    sources.forEach(collectSource);
    if (!choices.length) fallbackSources.forEach(collectSource);

    if (choices.length) return choices;

    const directQuestion = props?.question || fallbackAssignment?.question || props?.prompt || fallbackAssignment?.prompt;
    const directAnswer = props?.answer || fallbackAssignment?.answer || props?.correctAnswer || fallbackAssignment?.correctAnswer;
    if (directQuestion && directAnswer) {
      return [toChoiceRecord(directQuestion, directAnswer)];
    }

    return [];
  }

  function extractQuizChoices(quizList) {
    if (!Array.isArray(quizList)) return [];
    const choices = [];

    for (const item of quizList) {
      if (!item || typeof item !== 'object') continue;
      const question = item.question || item.prompt || item.title || item.text || item.statement || item.content || '';
      const answer = item.answer || item.correctAnswer || item.correct || item.solution || item.value || '';
      if (question && answer) appendUniqueChoice(choices, toChoiceRecord(question, answer));

      const options = item.options || item.answers || item.choiceList || item.choices || [];
      if (Array.isArray(options)) {
        for (const option of options) {
          if (!option) continue;
          const optionQuestion = question || option.question || option.prompt || option.title || '';
          const optionAnswer = option.answer || option.value || option.correct || option.text || option.word || option.label || option.solution || '';
          if (optionQuestion && optionAnswer) appendUniqueChoice(choices, toChoiceRecord(optionQuestion, optionAnswer));
        }
      }
    }

    return choices;
  }

  function normalizeQuizAnswer(answer, index) {
    if (!answer || typeof answer !== 'object') return null;
    const rawText = answer.answer || answer.text || answer.label || answer.value || answer.content || answer.title || '';
    if (!rawText) return null;
    const text = String(rawText).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
    return {
      index,
      id: String(answer.id ?? index),
      text: String(text),
      textNormalized: normalizeVisibleQuizOption(text),
      isCorrect: answer.is_correct === true || answer.is_correct === 1 || answer.isCorrect === true ||
        answer.isCorrect === 1 || answer.correct === true || answer.correct === 1 ||
        String(answer.is_correct ?? answer.isCorrect ?? answer.correct ?? '').toLowerCase() === 'true'
    };
  }

  function extractQuizProblems(props) {
    const sources = [
      props?.problems,
      props?.problemList,
      props?.problem_list,
      props?.quiz?.problems,
      props?.quiz?.problemList,
      props?.quizData?.problems,
      props?.currentProblem ? [props.currentProblem] : null,
      props?.problem ? [props.problem] : null
    ];
    const problems = [];

    for (const source of sources) {
      if (!Array.isArray(source)) continue;
      for (const problem of source) {
        if (!problem || typeof problem !== 'object') continue;
        const category = String(problem.category || problem.type || 'Choice');
        const answers = problem.answers || problem.options || problem.choices || [];
        if (!Array.isArray(answers)) continue;
        const normalizedAnswers = answers.map(normalizeQuizAnswer).filter(Boolean);
        // None 유형은 선택지 없이 자체 완료되는 실제 Quiz 카테고리
        if (!normalizedAnswers.length && normalizeText(category) !== 'none') continue;
        problems.push({
          id: String(problem.id ?? problems.length),
          category,
          question: String(problem.problem || problem.question || problem.title || problem.text || problem.content || ''),
          answers: normalizedAnswers
        });
      }
      if (problems.length) break;
    }

    return problems;
  }

  function summarizeQuiz(props) {
    const problems = extractQuizProblems(props);
    if (!problems.length) return null;
    const currentProblem = props?.currentProblem || props?.problem || null;
    const explicitIndex = props?.currentIndex ?? props?.currentProblemIndex ?? props?.problemIndex ?? props?.index;
    const currentIndex = explicitIndex === undefined
      ? problems.findIndex((problem) => currentProblem && String(problem.id) === String(currentProblem.id))
      : Number(explicitIndex);
    return {
      currentIndex: Number.isInteger(currentIndex) && currentIndex >= 0 ? currentIndex : 0,
      problems
    };
  }

  function resolveVisibleQuizProblem(state) {
    if (!state?.problems?.length) return null;

    // 번호는 1, 문제는 0 부터 시작
    const visibleNumber = getVisibleQuizNumber();
    if (visibleNumber && visibleNumber <= state.problems.length) {
      return { ...state, currentIndex: visibleNumber - 1 };
    }

    const pageText = normalizeText(document.body?.innerText || '');
    const visibleIndex = state.problems.findIndex((problem) => {
      const question = normalizeText(String(problem.question || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' '));
      return question.length >= 12 && pageText.includes(question);
    });
    if (visibleIndex >= 0) {
      return { ...state, currentIndex: visibleIndex };
    }

    const visibleOptions = new Set(
      Array.from(document.querySelectorAll('[data-dd-action="hw__hw_quiz__test"], .answer-button-container'))
        .map((node) => normalizeVisibleQuizOption(node.textContent))
        .filter(Boolean)
    );
    if (visibleOptions.size >= 2) {
      const scoredProblems = state.problems.map((problem, index) => ({
        index,
        score: problem.answers.reduce(
          (score, answer) => score + (visibleOptions.has(normalizeVisibleQuizOption(answer.text)) ? 1 : 0),
          0
        )
      }));
      const best = scoredProblems.sort((a, b) => b.score - a.score)[0];
      const bestScore = best?.score || 0;
      const isUniqueBest = scoredProblems.filter((problem) => problem.score === bestScore).length === 1; // 가장 높은 점수가 유일한 경우에만 채택
      if (bestScore >= 2 && isUniqueBest) {
        return { ...state, currentIndex: best.index };
      }
    }

    return state.problems.length === 1 ? state : null;
  }

  function getVisibleQuizNumber() {
    const nodes = document.querySelectorAll('.problem-text-container, [class*="problem_text"]');
    for (const node of nodes) {
      if (!node.getClientRects().length) continue;
      const text = String(node.textContent || '');
      const match = text.match(/^\s*(?:(?:q|question|문제)\s*(\d+)\b|(\d+)\s*(?:[.)]|번\b))/i);
      if (match) return Number(match[1] || match[2]);
    }
    return null;
  }

  function normalizeVisibleQuizOption(value) {
    return normalizeText(value)
      .replace(/^\s*(?:\d+|[a-z])\s*[.)]\s*/i, '')
      .replace(/^\s*[①②③④⑤]\s*/, '')
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[，、]/g, ',');
  }

  function scoreQuizStateAgainstPage(state) {
    const problem = state?.problems?.[state.currentIndex];
    if (!problem) return -1;
    const optionLabels = new Set(
      Array.from(document.querySelectorAll('[data-dd-action="hw__hw_quiz__test"], .answer-button-container'))
        .map((node) => normalizeVisibleQuizOption(node.textContent))
        .filter(Boolean)
    );
    if (!optionLabels.size) {
      const category = normalizeText(problem.category);
      const hasQuizSurface = Boolean(document.querySelector('.problem-text-container, [class*="problem_text"]'));
      // Short/None은 DOM 보기가 없으므로 번호로 결정된 현재 문항과 Quiz 표면을 최소 검증으로 사용
      return hasQuizSurface && ['short', 'none'].includes(category) ? 1 : 0;
    }

    const correctAnswers = problem.answers.filter((answer) => answer.isCorrect);
    if (!correctAnswers.length) return 0;
    return correctAnswers.reduce(
      (score, answer) => score + (optionLabels.has(normalizeVisibleQuizOption(answer.text)) ? 10 : 0),
      0
    );
  }

  function summarizeAssignment(props, fallbackAssignment) {
    const assignment = props?.testAssignment || props?.assignment || props?.currentAssignment || fallbackAssignment || {};
    const typeValue =
      props?.test_type ||
      props?.type ||
      props?.currentType ||
      props?.assignmentType ||
      props?.testType ||
      assignment?.test_type ||
      assignment?.type ||
      assignment?.kind ||
      '';

    const wordList = props?.wordList || props?.word_list || assignment?.word_list || assignment?.wordList || props?.currentWordList || [];
    const answerList = props?.answerList || props?.answers || assignment?.answerList || assignment?.answers || [];
    const quizList = props?.quizList || props?.quiz_list || props?.currentQuizList || assignment?.quiz_list || assignment?.quizList || [];
    let choices = extractWordChoices(wordList, answerList);

    if (!choices.length) {
      choices = extractQuizChoices(quizList);
    }

    if (!choices.length) {
      choices = extractGenericChoices(props, assignment);
    }

    if (!choices.length) {
      const question = props?.question || assignment?.question || props?.prompt || assignment?.prompt || '';
      const answer = props?.answer || assignment?.answer || props?.correctAnswer || assignment?.correctAnswer || '';
      if (question && answer) {
        choices = [toChoiceRecord(question, answer)];
      }
    }

    return {
      type: String(typeValue || 'unknown').toLowerCase(),
      choices: choices.filter(Boolean)
    };
  }

  function summarizeSentence(props) {
    if (!props || typeof props !== 'object') return null;
    const words = props.words || props.sentenceWords || props.wordList || props.word_list || [];
    const rawIndex = props.wordIndex ?? props.currentWordIndex ?? props.answerIndex ?? props.currentIndex;
    const index = Number(rawIndex);
    if (!Array.isArray(words) || !Number.isInteger(index) || index < 0 || index >= words.length) return null;

    const target = words[index]?.value || words[index]?.word || words[index]?.text || words[index]?.answer || '';
    if (!target) return null;
    return {
      target: String(target),
      targetNormalized: normalizeLearningText(target),
      index,
      words: words.map((word) => String(word?.value || word?.word || word?.text || word?.answer || '')).filter(Boolean)
    };
  }

  function postWordState(state) {
    try {
      window.postMessage(
        {
          source: 'autohour-page',
          action: 'wordState',
          state: state
            ? {
                type: String(state.type || 'unknown'),
                choices: Array.isArray(state.choices)
                  ? state.choices.map((choice) => ({
                      question: String(choice.question || ''),
                      answer: String(choice.answer || ''),
                      questionNormalized: String(choice.questionNormalized || ''),
                      answerNormalized: String(choice.answerNormalized || '')
                    }))
                  : []
              }
            : null
        },
        location.origin
      );
    } catch (error) {
      console.debug('AutoHour bridge state was not sent:', error);
    }
  }

  function postSentenceState(state) {
    try {
      window.postMessage({
        source: 'autohour-page',
        action: 'sentenceState',
        state: state
          ? {
              target: String(state.target || ''),
              targetNormalized: String(state.targetNormalized || ''),
              index: Number(state.index || 0),
              words: Array.isArray(state.words) ? state.words.map(String) : []
            }
          : null
      }, location.origin);
    } catch (error) {
      console.debug('AutoHour sentence state was not sent:', error);
    }
  }

  function postQuizState(state, diagnostics = null) {
    try {
      window.postMessage({
        source: 'autohour-page',
        action: 'quizState',
        state: state
          ? {
              currentIndex: Number(state.currentIndex || 0),
              problems: state.problems.map((problem) => ({
                id: String(problem.id),
                category: String(problem.category),
                question: String(problem.question || ''),
                answers: problem.answers.map((answer) => ({
                  index: Number(answer.index),
                  id: String(answer.id),
                  text: String(answer.text),
                  textNormalized: String(answer.textNormalized),
                  isCorrect: Boolean(answer.isCorrect)
                }))
              })),
              diagnostics: state.diagnostics || diagnostics
            }
          : null,
        diagnostics: state?.diagnostics || diagnostics
      }, location.origin);
    } catch (error) {
      console.debug('AutoHour quiz state was not sent:', error);
    }
  }

  function findAssignmentState(node) {
    const fiberName = Object.getOwnPropertyNames(node).find((key) => key.startsWith('__reactFiber'));
    let fiber = fiberName ? node[fiberName] : null;
    const seen = new Set();

    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      const props = fiber.memoizedProps || fiber.pendingProps || {};
      if (props) {
        const summary = summarizeAssignment(props, props.testAssignment || props.assignment || props.currentAssignment || {});
        if (summary.choices.length) return summary;
      }

      const nested = Object.values(props || {}).filter((value) => value && typeof value === 'object');
      for (const nestedValue of nested) {
        if (Array.isArray(nestedValue)) {
          for (const item of nestedValue) {
            const nestedSummary = summarizeAssignment(item, item || {});
            if (nestedSummary.choices.length) return nestedSummary;
          }
        } else if (nestedValue && typeof nestedValue === 'object' && nestedValue !== props) {
          const nestedSummary = summarizeAssignment(nestedValue, nestedValue || {});
          if (nestedSummary.choices.length) return nestedSummary;
        }
      }

      fiber = fiber.return;
    }

    return null;
  }

  function findSentenceState(node) {
    const fiberName = Object.getOwnPropertyNames(node).find((key) => key.startsWith('__reactFiber'));
    let fiber = fiberName ? node[fiberName] : null;
    const seen = new Set();

    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      const props = fiber.memoizedProps || fiber.pendingProps || {};
      const direct = summarizeSentence(props);
      if (direct) return direct;

      for (const value of Object.values(props)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const nested = summarizeSentence(value);
        if (nested) return nested;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function findQuizState(node) {
    const fiberName = Object.getOwnPropertyNames(node).find((key) => key.startsWith('__reactFiber'));
    let fiber = fiberName ? node[fiberName] : null;
    const seen = new Set();
    let bestState = null;
    let bestScore = -1;
    let bestSource = '';
    let candidatesChecked = 0;

    const consider = (state, source) => {
      if (!state) return;
      candidatesChecked += 1;
      const score = scoreQuizStateAgainstPage(state);
      if (score > bestScore) {
        bestState = state;
        bestScore = score;
        bestSource = source;
      }
    };

    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      const props = fiber.memoizedProps || fiber.pendingProps || {};
      // Quiz 컴포넌트는 문제 목록과 현재 인덱스를 useRef에 저장함. 매우 신기한 로직. Hook 의 ref 값 사용
      const refValues = [];
      let hook = fiber.memoizedState;
      const seenHooks = new Set();
      while (hook && !seenHooks.has(hook)) {
        seenHooks.add(hook);
        const value = hook.memoizedState;
        if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'current')) {
          refValues.push(value.current);
        }
        hook = hook.next;
      }

      for (const value of refValues) {
        if (!Array.isArray(value) || !value.length) continue;
        const fromRef = summarizeQuiz({ problems: value });
        if (!fromRef) continue;
        const visibleRef = resolveVisibleQuizProblem(fromRef);
        consider(visibleRef, 'react-ref');
      }

      const direct = summarizeQuiz(props);
      const visibleDirect = resolveVisibleQuizProblem(direct);
      consider(visibleDirect, 'react-props');
      fiber = fiber.return;
    }
    
    if (bestScore <= 0 || !bestState) return null;
    return {
      ...bestState,
      diagnostics: {
        source: bestSource,
        candidateCount: candidatesChecked,
        answerMatchScore: bestScore,
        currentIndex: bestState.currentIndex,
        problemCount: bestState.problems.length
      }
    };
  }

  function getWordState() {
    const isReviewMode = new URLSearchParams(location.search).get('isReview') === 'true';
    const isQuizPage = /\/quiz\b|type=quiz|quiz-id=/.test(location.pathname + location.search);
    const optionButtons = document.querySelectorAll(
      isReviewMode || isQuizPage ? 'button, [role="button"], [class*="option"], [class*="choice"], [data-dd-action*="quiz"], [data-dd-action*="word-choice"], [data-dd-action*="word_choice"]' : WORD_CHOICE_SELECTOR
    );

    for (const node of optionButtons) {
      const state = findAssignmentState(node);
      if (state) return state;
    }

    const allNodes = document.querySelectorAll('*');
    for (const node of allNodes) {
      const state = findAssignmentState(node);
      if (state) return state;
    }

    return null;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== 'autohour-content') return;
    if (event.data.action === 'getWordState') postWordState(getWordState());
    if (event.data.action === 'getSentenceState') {
      const sentenceNodes = document.querySelectorAll('[data-dd-action="hw__hw_sentence__test"], [class*="sentence-choice"], input, textarea');
      for (const node of sentenceNodes) {
        const state = findSentenceState(node);
        if (state) {
          postSentenceState(state);
          return;
        }
      }
      postSentenceState(null);
    }
    if (event.data.action === 'getQuizState') {
      const quizNodes = document.querySelectorAll('[data-dd-action="hw__hw_quiz__test"], .answer-button-container, button, [role="button"], [class*="quiz"], [class*="problem"]');
      for (const node of quizNodes) {
        const state = findQuizState(node);
        if (state) {
          postQuizState(state, state.diagnostics);
          return;
        }
      }
      postQuizState(null, {
        source: 'none',
        candidateCount: 0,
        answerMatchScore: 0,
        currentIndex: -1,
        problemCount: 0,
        domAnswerNodeCount: document.querySelectorAll('[data-dd-action="hw__hw_quiz__test"], .answer-button-container').length,
        scannedNodeCount: quizNodes.length
      });
    }
  });
})();
