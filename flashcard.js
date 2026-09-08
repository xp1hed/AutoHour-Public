// 주의 아직 테스트 안해봄 작동 안할가능성 농후
(() => {
  const { normalizeText, isVisible, isDisabled } = globalThis.AutoHourUtils;
  const KNOW_ACTION = 'hw__hw_word_word-choice__test';
  const KNOW_ACTION_PATTERN = /^hw__hw_word_(word-choice|translation-choice|writing)__test$/;
  const FLASHCARD_MODE = 'flashcard';
  const CLICK_COOLDOWN_MS = 850; // 딜레이 추가

  let lastKnowButton = null;
  let lastClickAt = 0;
  let completed = false;

  function isFlashcardMode() {
    return new URLSearchParams(location.search).get('mode') === FLASHCARD_MODE;
  }

  function isDoneScreen() {
    const text = normalizeText(document.body?.textContent);
    return text.includes('플래시카드 단어 연습을 마쳤습니다') || text.includes('flashcard') && text.includes('completed');
  }

  function getKnowButton() {
    const candidates = document.querySelectorAll(`button[data-dd-action="${KNOW_ACTION}"], [role="button"][data-dd-action="${KNOW_ACTION}"], button, [role="button"]`);

    for (const node of candidates) {
      if (!isVisible(node) || isDisabled(node)) continue;

      const action = normalizeText(node.getAttribute('data-dd-action'));
      const label = normalizeText(node.textContent || node.value);
      const isKnowLabel = label.includes('알아요') || /\b(i know|know)\b/.test(label);
      const isDontKnowLabel = label.includes('몰라요') || /\b(i don\'t know|don\'t know|unknown)\b/.test(label);
      if ((action === KNOW_ACTION || KNOW_ACTION_PATTERN.test(action)) && isKnowLabel && !isDontKnowLabel) return node;
    }

    return null;
  }

  function getButtonLabel(node) {
    return String(node?.textContent || node?.value || '').replace(/\s+/g, ' ').trim();
  }

  function tick({ enabled }) {
    if (!isFlashcardMode()) {
      completed = false;
      lastKnowButton = null;
      lastClickAt = 0;
      return null;
    }

    if (!enabled) return { status: 'disabled', lastAction: 'flashcard_disabled' };
    if (completed || isDoneScreen()) {
      completed = true;
      return { status: 'flashcard_completed', lastAction: 'flashcard_done' };
    }

    const button = getKnowButton();
    if (!button) {
      return { status: 'waiting_for_flashcard', lastAction: 'waiting_for_know_button' };
    }

    if (button === lastKnowButton && Date.now() - lastClickAt < CLICK_COOLDOWN_MS) {
      return { status: 'waiting_for_next_flashcard', lastAction: 'cooldown' };
    }

    lastKnowButton = button;
    lastClickAt = Date.now();
    const label = getButtonLabel(button);
    button.click();
    return {
      status: 'flashcard_knowing',
      targetWord: label,
      lastAction: 'click:know'
    };
  }

  window.AutoHourFlashcardSolver = { isFlashcardMode, tick };
})();
