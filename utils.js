(() => {
  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isVisible(node) {
    return Boolean(node && node.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  }

  function isDisabled(node) {
    return Boolean(node?.disabled || node?.getAttribute('aria-disabled') === 'true');
  }

  function getNodeLabel(node) {
    return normalizeText(node?.textContent || node?.value || '');
  }

  function setNativeInputValue(node, value) {
    if (!node) return false;
    const prototype = node instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : node instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(node, String(value ?? ''));
    return true;
  }

  globalThis.AutoHourUtils = Object.freeze({ normalizeText, isVisible, isDisabled, getNodeLabel, setNativeInputValue });
})();
