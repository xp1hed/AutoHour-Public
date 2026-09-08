// UA 확인하고 블락 때리기 때문에 바이패스를 해야해서 추가
// 근데 이해 안가는게 크로미움기반은 좀 허용해주지 왜 굳이 사파리/크롬/카톡인앱브라우저 등 별도만 허용하는지 모르겠음.
(() => {
  'use strict';

  const TOKEN = '1hour_webapp';
  const SETTINGS_KEY = 'autohour.ua-settings';
  const DEFAULT_SETTINGS = { googleChrome: true, webapp: false };

  function getSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        googleChrome: saved.googleChrome !== false,
        webapp: saved.webapp === true
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  const settings = getSettings();

  function appendToken(value) {
    const userAgent = String(value || '');
    if (!settings.webapp) return userAgent;
    return new RegExp(`(?:^|\\s)${TOKEN}(?:\\s|$)`, 'i').test(userAgent)
      ? userAgent
      : `${userAgent} ${TOKEN}`.trim();
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
    if (descriptor?.get) {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get() {
          return appendToken(descriptor.get.call(navigator));
        }
      });
    }
  } catch {
  }

  // 모바일 브라우저 판별을 ua보다 UA Client Hints를 먼저 확인함. 신기한 로직
  try {
    if (!settings.googleChrome || !/android/i.test(navigator.userAgent)) return;

    const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgentData');
    const original = descriptor?.get?.call(navigator);
    if (!original || !Array.isArray(original.brands)) return;

    const hasSupportedBrand = original.brands.some(({ brand }) => /chrome|whale/i.test(String(brand)));
    if (hasSupportedBrand) return;

    const brands = [...original.brands, { brand: 'Google Chrome', version: '120' }];
    const userAgentData = new Proxy(original, {
      get(target, property) {
        if (property === 'brands') return brands;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });

    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      get() {
        return userAgentData;
      }
    });
  } catch {
  }
})();
