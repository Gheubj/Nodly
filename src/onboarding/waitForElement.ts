export function anchorSelector(attr: string): string {
  return `[data-onboarding="${attr}"]`;
}

export function waitForElement(selector: string, timeoutMs = 4500): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) {
        resolve(el);
        return;
      }
      if (performance.now() - t0 >= timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
