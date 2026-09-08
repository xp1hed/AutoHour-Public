// 영상시청과제
(() => {
  const { normalizeText, isVisible, isDisabled, getNodeLabel } = globalThis.AutoHourUtils;
  const COMPLETE_LABELS = new Set(['시청 완료', '학습 완료', '완료', 'complete', 'complete assignment', 'watch complete']);
  let clicked = false;

  function isWatchMode() {
    return /\/content-watch\b|test_type=watch/i.test(location.pathname + location.search);
  }

  function findCompletionButton() {
    return Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .find((node) => isVisible(node) && !isDisabled(node) && COMPLETE_LABELS.has(getNodeLabel(node)));
  }

  function tick({ enabled }) {
    if (!isWatchMode()) {
      clicked = false;
      return null;
    }
    if (!enabled) return { status: 'disabled', lastAction: 'watch_disabled' };
    if (clicked) return { status: 'watch_completion_requested', lastAction: 'awaiting_watch_completion' };

    const video = Array.from(document.querySelectorAll('video')).find(isVisible);
    if (!video) return { status: 'waiting_for_watch_video', lastAction: 'waiting_for_video' };
    if (!video.ended) {
      return { status: 'watching_content', lastAction: 'waiting_for_video_end' };
    }

    const button = findCompletionButton();
    if (!button) return { status: 'waiting_for_watch_completion_button', lastAction: 'video_ended' };
    clicked = true;
    button.click();
    return { status: 'completing_watch_assignment', lastAction: 'click:watch_complete' };
  }

  window.AutoHourWatchSolver = { isWatchMode, tick };
})();
