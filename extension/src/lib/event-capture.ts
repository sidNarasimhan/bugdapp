/**
 * DOM event capture module for recording user interactions
 *
 * Captures:
 * - Clicks on actionable elements (buttons, links, inputs, [role="button"])
 * - Input value changes (debounced 300ms, immediate on blur)
 * - Navigation events (URL changes via History API and popstate)
 *
 * Skips:
 * - Password fields (security)
 * - Hover/scroll events (too noisy)
 * - Non-interactive elements
 */

import { generateSelector, getElementMetadata, getParentOuterHTML, getNearbyVisibleText, getCurrentHeadingContext } from './selector';
import type { RecordedStep, SuccessSnapshot } from './steps';

// Capture state
let isCapturing = false;
let currentSessionId: string | null = null;

// Debounce timers for input fields
const inputTimers = new Map<Element, number>();
const INPUT_DEBOUNCE_MS = 300;

// Store original History methods for cleanup
let originalPushState: typeof history.pushState | null = null;
let originalReplaceState: typeof history.replaceState | null = null;

// Track last captured URL to avoid duplicates
let lastCapturedUrl = '';

// Pointerdown fallback: track pending pointerdown that may not get a click
let pendingPointerdown: { element: Element; timer: number } | null = null;
const POINTERDOWN_CLICK_WINDOW_MS = 400;

/**
 * Actionable element types that should capture clicks
 */
const ACTIONABLE_TAGS = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
const ACTIONABLE_ROLES = ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio'];
const ACTIONABLE_INPUT_TYPES = ['button', 'submit', 'reset', 'checkbox', 'radio'];

/**
 * Check if an element or its ancestors are actionable
 */
function findActionableAncestor(element: Element | null, maxDepth = 10): Element | null {
  let current = element;
  let depth = 0;

  while (current && depth < maxDepth) {
    // Check tag name
    if (ACTIONABLE_TAGS.includes(current.tagName)) {
      return current;
    }

    // Check role attribute
    const role = current.getAttribute('role');
    if (role && ACTIONABLE_ROLES.includes(role)) {
      return current;
    }

    // Check for data-testid (always actionable — devs only put testids on interactive elements)
    if (current.hasAttribute('data-testid')) {
      return current;
    }

    // Check for click handlers (heuristic)
    if (current.hasAttribute('onclick') || current.hasAttribute('data-click')) {
      return current;
    }

    // Check for cursor pointer style (heuristic)
    const style = window.getComputedStyle(current);
    if (style.cursor === 'pointer') {
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  return null;
}

/**
 * Check if input type should be captured (skip password)
 */
function shouldCaptureInput(element: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (element instanceof HTMLInputElement) {
    // Skip password fields for security
    if (element.type === 'password') {
      return false;
    }
    // Skip hidden fields
    if (element.type === 'hidden') {
      return false;
    }
  }
  return true;
}

/**
 * Create a recorded step and send to background
 */
function captureStep(step: Omit<RecordedStep, 'id' | 'timestamp'>): void {
  if (!isCapturing || !currentSessionId) {
    return;
  }

  const recordedStep: RecordedStep = {
    ...step,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };

  // Send to background worker
  chrome.runtime.sendMessage({
    type: 'STEP_CAPTURED',
    sessionId: currentSessionId,
    step: recordedStep,
    timestamp: Date.now(),
  }).catch((error) => {
    console.warn('Failed to send step to background:', error);
  });

  console.log('Step captured:', recordedStep.type, recordedStep.selector || recordedStep.url);
}

/**
 * Handle click events
 */
function handleClick(event: MouseEvent): void {
  if (!isCapturing) return;

  const target = event.target as Element;
  const actionable = findActionableAncestor(target);

  if (!actionable) {
    // Click landed on a non-actionable element (e.g., page behind a closed dialog).
    // Do NOT clear the pending pointerdown — let the fallback timer fire so
    // clicks on dialog buttons that close before mouseup are still captured.
    return;
  }

  // Actionable click found — clear pointerdown fallback since we'll capture this click directly
  if (pendingPointerdown) {
    clearTimeout(pendingPointerdown.timer);
    pendingPointerdown = null;
  }

  // For input types that are click-based (checkbox, radio, button), capture the click
  if (actionable.tagName === 'INPUT') {
    const input = actionable as HTMLInputElement;
    if (!ACTIONABLE_INPUT_TYPES.includes(input.type)) {
      // Non-actionable input type (text, email, etc.) - handled by input event
      return;
    }
  }

  captureClickOnElement(actionable);
}

/**
 * Capture a click on a resolved actionable element.
 * Shared by both the click handler and pointerdown fallback.
 */
function captureClickOnElement(actionable: Element): void {
  // If clicked element has no useful metadata, walk up to find the semantic parent
  let resolvedElement = actionable;
  const initialMeta = getElementMetadata(actionable);
  if (!initialMeta.text && !initialMeta.role && !initialMeta.ariaLabel && !initialMeta.dataTestId) {
    const parent = actionable.parentElement;
    if (parent) {
      const parentMeta = getElementMetadata(parent);
      if (parentMeta.role || parentMeta.ariaLabel || parentMeta.dataTestId) {
        resolvedElement = parent;
      }
    }
  }

  const selector = generateSelector(resolvedElement);
  const metadata = getElementMetadata(resolvedElement);

  let parentOuterHTML: string | undefined;
  let nearbyText: string | undefined;
  let headingContext: string | undefined;
  try {
    parentOuterHTML = getParentOuterHTML(resolvedElement);
    nearbyText = getNearbyVisibleText(resolvedElement);
    headingContext = getCurrentHeadingContext();
  } catch {
    // DOM context capture is best-effort
  }

  captureStep({
    type: 'click',
    selector,
    metadata: {
      tagName: metadata.tagName,
      text: metadata.text,
      ariaLabel: metadata.ariaLabel,
      role: metadata.role,
      dataTestId: metadata.dataTestId,
      inputType: metadata.type,
      inputName: metadata.name,
      parentOuterHTML,
      nearbyText,
      pageTitle: document.title,
      headingContext,
      dataState: metadata.dataState,
      ariaChecked: metadata.ariaChecked,
      nearbyLabel: metadata.nearbyLabel,
    },
  });
}

/**
 * Handle pointerdown events — fallback for elements that get removed from DOM
 * before click fires (e.g., modal confirm buttons that close on pointerdown).
 */
function handlePointerDown(event: PointerEvent): void {
  if (!isCapturing) return;

  const target = event.target as Element;
  const actionable = findActionableAncestor(target);

  if (!actionable) return;

  // For text inputs, skip — handled by input event
  if (actionable.tagName === 'INPUT') {
    const input = actionable as HTMLInputElement;
    if (!ACTIONABLE_INPUT_TYPES.includes(input.type)) return;
  }

  // Clear any previous pending pointerdown
  if (pendingPointerdown) {
    clearTimeout(pendingPointerdown.timer);
  }

  // Store a snapshot — if click fires within the window, it will clear this.
  // If click never fires (element removed from DOM), the timer captures it.
  const timer = window.setTimeout(() => {
    if (pendingPointerdown?.element === actionable) {
      console.log('Pointerdown fallback: click never fired, capturing via pointerdown');
      captureClickOnElement(actionable);
      pendingPointerdown = null;
    }
  }, POINTERDOWN_CLICK_WINDOW_MS);

  pendingPointerdown = { element: actionable, timer };
}

/**
 * Handle input events (with debouncing)
 */
function handleInput(event: Event): void {
  if (!isCapturing) return;

  const target = event.target as HTMLInputElement | HTMLTextAreaElement;

  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (!shouldCaptureInput(target)) {
    return;
  }

  // Clear existing debounce timer
  const existingTimer = inputTimers.get(target);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new debounce timer
  const timer = window.setTimeout(() => {
    captureInputValue(target);
    inputTimers.delete(target);
  }, INPUT_DEBOUNCE_MS);

  inputTimers.set(target, timer);
}

/**
 * Handle blur events (immediate capture)
 */
function handleBlur(event: FocusEvent): void {
  if (!isCapturing) return;

  const target = event.target as HTMLInputElement | HTMLTextAreaElement;

  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (!shouldCaptureInput(target)) {
    return;
  }

  // Clear any pending debounce timer
  const existingTimer = inputTimers.get(target);
  if (existingTimer) {
    clearTimeout(existingTimer);
    inputTimers.delete(target);
  }

  // Capture immediately on blur
  captureInputValue(target);
}

/**
 * Capture input value
 */
function captureInputValue(target: HTMLInputElement | HTMLTextAreaElement): void {
  const value = target.value;

  // Skip empty values
  if (!value) {
    return;
  }

  const selector = generateSelector(target);
  const metadata = getElementMetadata(target);

  captureStep({
    type: 'input',
    selector,
    value,
    metadata: {
      tagName: metadata.tagName,
      inputType: metadata.type,
      inputName: metadata.name,
      placeholder: metadata.placeholder,
    },
  });
}

/**
 * Handle navigation events
 */
function handleNavigation(url: string): void {
  if (!isCapturing) return;

  // Avoid duplicate captures
  if (url === lastCapturedUrl) {
    return;
  }

  lastCapturedUrl = url;

  captureStep({
    type: 'navigation',
    url,
  });
}

/**
 * Create wrapped History method
 */
function createHistoryWrapper(
  original: typeof history.pushState | typeof history.replaceState
): typeof history.pushState {
  return function (
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null
  ): void {
    original.call(this, data, unused, url);

    if (url) {
      const newUrl = new URL(url.toString(), window.location.href).href;
      handleNavigation(newUrl);
    }
  };
}

/**
 * Handle popstate event (back/forward navigation)
 */
function handlePopState(): void {
  handleNavigation(window.location.href);
}

/**
 * Initialize event capture
 */
export function initEventCapture(sessionId: string): void {
  if (isCapturing) {
    console.warn('Event capture already active');
    return;
  }

  console.log('Initializing event capture for session:', sessionId);

  isCapturing = true;
  currentSessionId = sessionId;
  lastCapturedUrl = window.location.href;

  // Add event listeners (capture phase for clicks to catch all)
  document.addEventListener('click', handleClick, true);
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('blur', handleBlur, true);

  // Override History API methods
  originalPushState = history.pushState.bind(history);
  originalReplaceState = history.replaceState.bind(history);
  history.pushState = createHistoryWrapper(originalPushState);
  history.replaceState = createHistoryWrapper(originalReplaceState);

  // Listen for popstate (back/forward)
  window.addEventListener('popstate', handlePopState);

  console.log('Event capture initialized');
}

/**
 * Capture current page state for success verification.
 * Extracts visible text from the viewport for use in generating assertions.
 * Returns snapshot data (no screenshot — that's handled by the background script).
 */
export function capturePageState(): Omit<SuccessSnapshot, 'screenshot'> {
  const selectors = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'span', 'button', 'a',
    '[role="alert"]', '[role="status"]',
    'div[class*="toast"]', 'div[class*="success"]', 'div[class*="notification"]',
    'div[class*="message"]', 'div[class*="banner"]',
    'td', 'th', 'li', 'label',
  ];

  const seen = new Set<string>();
  const visibleText: string[] = [];

  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        // Check if element is in viewport
        const rect = el.getBoundingClientRect();
        if (
          rect.width === 0 || rect.height === 0 ||
          rect.bottom < 0 || rect.top > window.innerHeight ||
          rect.right < 0 || rect.left > window.innerWidth
        ) {
          continue;
        }

        // Get direct text content (not deeply nested child text)
        const text = (el.textContent || '').trim();
        if (text.length < 2 || text.length > 200) continue;
        if (seen.has(text)) continue;

        seen.add(text);
        visibleText.push(text);

        if (visibleText.length >= 50) break;
      }
    } catch {
      // Skip invalid selectors
    }
    if (visibleText.length >= 50) break;
  }

  return {
    visibleText,
    url: window.location.href,
    pageTitle: document.title,
    timestamp: Date.now(),
  };
}

/**
 * Stop event capture
 */
export function stopEventCapture(): void {
  if (!isCapturing) {
    return;
  }

  console.log('Stopping event capture');

  isCapturing = false;
  currentSessionId = null;

  // Remove event listeners
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('pointerdown', handlePointerDown, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('blur', handleBlur, true);

  // Clear pending pointerdown
  if (pendingPointerdown) {
    clearTimeout(pendingPointerdown.timer);
    pendingPointerdown = null;
  }

  // Restore History API methods
  if (originalPushState) {
    history.pushState = originalPushState;
    originalPushState = null;
  }
  if (originalReplaceState) {
    history.replaceState = originalReplaceState;
    originalReplaceState = null;
  }

  // Remove popstate listener
  window.removeEventListener('popstate', handlePopState);

  // Clear any pending timers
  inputTimers.forEach((timer) => clearTimeout(timer));
  inputTimers.clear();

  console.log('Event capture stopped');
}
