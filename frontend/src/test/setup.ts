import '@testing-library/jest-dom';

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserver;

// jsdom has no Element.scrollTo/scrollBy; the message list's virtualizer (Virtua)
// scrolls through them. Route both to scrollTop so tests can observe the result.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function (
    this: Element,
    arg?: ScrollToOptions | number,
    y?: number
  ) {
    const top = typeof arg === 'object' ? arg.top : y;
    if (top !== undefined) this.scrollTop = top;
  } as Element['scrollTo'];
}
if (!Element.prototype.scrollBy) {
  Element.prototype.scrollBy = function (
    this: Element,
    arg?: ScrollToOptions | number,
    y?: number
  ) {
    const top = typeof arg === 'object' ? arg.top : y;
    if (top !== undefined) this.scrollTop += top;
  } as Element['scrollBy'];
}

// Several components call matchMedia at import time for responsive detection.
// Use a configurable descriptor so individual tests can override the stub.
if (typeof globalThis.matchMedia === 'undefined') {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
