const overflowPattern = /(auto|scroll|overlay)/;
const focusablePattern = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Hides scrollbars and shows non-layout edge fades for scrollable regions. */
export function initScrollHints(root = document) {
  if (new URLSearchParams(window.location.search).get('nofx') === '1') return () => {};

  const tracked = new Map();
  let frame = 0;
  let stopped = false;
  let inFrame = false;

  function schedule() {
    if (stopped || inFrame || frame) return;
    frame = requestAnimationFrame(updateAll);
  }

  function isScrollable(element) {
    const style = getComputedStyle(element);
    return element === document.scrollingElement
      || element === document.documentElement
      || [style.overflowX, style.overflowY].some((value) => overflowPattern.test(value));
  }

  function setAttributeState(element, name, enabled) {
    if (element.hasAttribute(name) === enabled) return;
    element.toggleAttribute(name, enabled);
  }

  function update(element) {
    if (!element.isConnected) return;
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    setAttributeState(element, 'data-scroll-top', element.scrollTop > 1);
    setAttributeState(element, 'data-scroll-bottom', maxScroll - element.scrollTop > 1);
  }

  function track(element) {
    if (!(element instanceof Element)) return;
    const cleanupExisting = tracked.get(element);
    if (cleanupExisting) {
      if (!isScrollable(element)) { cleanupExisting(); tracked.delete(element); }
      else element.classList.add('scroll-hidden');
      return;
    }
    if (!isScrollable(element)) return;

    const hadClass = element.classList.contains('scroll-hidden');
    element.classList.add('scroll-hidden');
    const hasFocusableContent = element.matches(focusablePattern) || Boolean(element.querySelector(focusablePattern));
    const addedTabindex = !hasFocusableContent && !element.hasAttribute('tabindex');
    const addedLabel = !hasFocusableContent && !element.hasAttribute('aria-label');
    if (addedTabindex) element.setAttribute('tabindex', '0');
    if (addedLabel) element.setAttribute('aria-label', element.dataset.scrollLabel || 'Scrollable content');

    const onScroll = schedule;
    element.addEventListener('scroll', onScroll, { passive: true });
    resizeObserver?.observe(element);
    tracked.set(element, () => {
      element.removeEventListener('scroll', onScroll);
      resizeObserver?.unobserve(element);
      element.removeAttribute('data-scroll-top');
      element.removeAttribute('data-scroll-bottom');
      if (!hadClass) element.classList.remove('scroll-hidden');
      if (addedTabindex) element.removeAttribute('tabindex');
      if (addedLabel) element.removeAttribute('aria-label');
    });
  }

  function scan(node) {
    if (!(node instanceof Element || node instanceof Document)) return;
    if (node instanceof Element) track(node);
    node.querySelectorAll?.('*').forEach(track);
  }

  function untrack(node) {
    if (!(node instanceof Element)) return;
    [node, ...node.querySelectorAll('*')].forEach((element) => {
      const cleanup = tracked.get(element);
      if (cleanup) { cleanup(); tracked.delete(element); }
    });
  }

  function updateAll() {
    frame = 0;
    if (stopped || inFrame) return;
    inFrame = true;
    try {
      scan(root);
      tracked.forEach((_cleanup, element) => update(element));
    } finally {
      inFrame = false;
    }
  }

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  const mutationObserver = new MutationObserver(schedule);
  mutationObserver.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
  const onResize = schedule;
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('load', schedule, true);
  schedule();

  return () => {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    mutationObserver.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('load', schedule, true);
    tracked.forEach((cleanup) => cleanup());
    tracked.clear();
  };
}
