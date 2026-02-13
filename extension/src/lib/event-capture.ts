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
import type { RecordedStep } from './steps';

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

/**
 * Actionable element types that should capture clicks
 */
const ACTIONABLE_TAGS = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
const ACTIONABLE_ROLES = ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio'];
const ACTIONABLE_INPUT_TYPES = ['button', 'submit', 'reset', 'checkbox', 'radio'];

/**
 * Check if an element or its ancestors are actionable
 */
function findActionableAncestor(element: Element | null, maxDepth = 5): Element | null {
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
    return;
  }

  // For input types that are click-based (checkbox, radio, button), capture the click
  if (actionable.tagName === 'INPUT') {
    const input = actionable as HTMLInputElement;
    if (!ACTIONABLE_INPUT_TYPES.includes(input.type)) {
      // Non-actionable input type (text, email, etc.) - handled by input event
      return;
    }
  }

  const selector = generateSelector(actionable);
  const metadata = getElementMetadata(actionable);

  // Capture DOM context for richer AI understanding
  let parentOuterHTML: string | undefined;
  let nearbyText: string | undefined;
  let headingContext: string | undefined;
  try {
    parentOuterHTML = getParentOuterHTML(actionable);
    nearbyText = getNearbyVisibleText(actionable);
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
    },
  });
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
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('blur', handleBlur, true);

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
