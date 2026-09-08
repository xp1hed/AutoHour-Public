(() => {
  const { normalizeText, isVisible, isDisabled, getNodeLabel, setNativeInputValue } = globalThis.AutoHourUtils;
  const SENTENCE_ACTION = 'hw__hw_sentence__test';
  const SUBMIT_LABELS = new Set(['확인', '제출', '제출하기', '정답확인', 'check', 'submit']);
  const NEXT_LABELS = new Set(['next', '다음', '계속', 'continue']);
  let sentenceState = null;
  let lastRequestAt = 0;
  let lastActionKey = '';
  let nextAttemptAt = 0;

  function isSentenceMode() {
    return /\/sentence\b|\/writingai\/sentence\b|test_type=(select|write|syntax)/i.test(location.pathname + location.search);
  }

  function normalizeAnswer(value) {
    return normalizeText(value).replace(/[^a-z0-9가-힣ぁ-ゟァ-ヿ一-龯]/gi, '');
  }

  function requestState() {
    const now = Date.now();
    if (now - lastRequestAt < 300) return;
    lastRequestAt = now;
    window.postMessage({ source: 'autohour-content', action: 'getSentenceState' }, location.origin);
  }

  function getChoiceNodes() {
    return Array.from(document.querySelectorAll(`[data-dd-action="${SENTENCE_ACTION}"], [class*="sentence-choice__button"]`))
      .filter((node) => isVisible(node) && !isDisabled(node))
      .filter((node) => {
        const label = getNodeLabel(node);
        return label && !NEXT_LABELS.has(label);
      });
  }

  function getSubmitButton() {
    return Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .find((node) => isVisible(node) && !isDisabled(node) && SUBMIT_LABELS.has(getNodeLabel(node)));
  }

  function getTextInput() {
    return Array.from(document.querySelectorAll('input[type="text"], textarea, input:not([type])'))
      .find((node) => isVisible(node) && !isDisabled(node));
  }

  function tick({ enabled }) {
    if (!isSentenceMode()) {
      sentenceState = null;
      lastActionKey = '';
      return null;
    }
    if (!enabled) return { status: 'disabled', lastAction: 'sentence_disabled' };

    requestState();
    if (!sentenceState?.target) {
      return { status: 'waiting_for_sentence_state', lastAction: 'requesting_sentence_state' };
    }
    if (Date.now() < nextAttemptAt) {
      return { status: 'waiting_for_sentence_transition', targetWord: sentenceState.target, lastAction: 'settling_sentence_transition' };
    }

    const target = normalizeAnswer(sentenceState.target);
    const choices = getChoiceNodes();
    const exact = choices.filter((node) => normalizeAnswer(getNodeLabel(node)) === target);
    const actionKey = `${sentenceState.index}|${target}`;
    if (exact.length === 1) {
      if (lastActionKey === actionKey) {
        return { status: 'waiting_for_sentence_feedback', targetWord: sentenceState.target, lastAction: 'awaiting_sentence_feedback' };
      }
      lastActionKey = actionKey;
      nextAttemptAt = Date.now() + 650;
      exact[0].click();
      return { status: 'sentence_selecting_answer', targetWord: sentenceState.target, lastAction: 'select:sentence_choice' };
    }

    const input = getTextInput();
    if (input && !choices.length) {
      if (lastActionKey === actionKey) {
        return { status: 'waiting_for_sentence_feedback', targetWord: sentenceState.target, lastAction: 'awaiting_sentence_submission' };
      }
      if (!setNativeInputValue(input, sentenceState.target)) {
        return { status: 'unsupported_sentence_input', targetWord: sentenceState.target, lastAction: 'missing_native_input_setter' };
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const submit = getSubmitButton();
      if (!submit) return { status: 'waiting_for_sentence_submit', targetWord: sentenceState.target, lastAction: 'typed_sentence_answer' };
      lastActionKey = actionKey;
      nextAttemptAt = Date.now() + 700;
      submit.click();
      return { status: 'sentence_submitting_answer', targetWord: sentenceState.target, lastAction: 'submit:sentence_input' };
    }

    return {
      status: choices.length ? 'waiting_for_sentence_option_match' : 'unsupported_sentence_layout',
      targetWord: sentenceState.target,
      lastAction: choices.length ? 'waiting_for_exact_sentence_match' : 'unsupported_sentence_layout'
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === 'autohour-page' && event.data.action === 'sentenceState') {
      const previousKey = sentenceState ? `${sentenceState.index}|${normalizeAnswer(sentenceState.target)}` : '';
      sentenceState = event.data.state;
      const nextKey = sentenceState ? `${sentenceState.index}|${normalizeAnswer(sentenceState.target)}` : '';
      if (previousKey !== nextKey) lastActionKey = '';
    }
  });

  window.AutoHourSentenceSolver = { isSentenceMode, tick };
})();
