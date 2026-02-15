/**
 * CSS selector generation utility for DOM element targeting
 * Prioritizes stable selectors for reliable test replay
 *
 * Priority order:
 * 1. data-testid attribute (most stable)
 * 2. id attribute (if unique)
 * 3. aria-label/role combinations
 * 4. CSS selector with nth-child fallback
 *
 * Blacklists CSS-in-JS hashed class names (css-, emotion-, styled-components)
 */

import getCssSelector from 'css-selector-generator';

// Inline type definition (matches css-selector-generator's CssSelectorGeneratorOptionsInput)
interface SelectorOptions {
  selectors?: Array<'id' | 'class' | 'tag' | 'attribute' | 'nthchild' | 'nthoftype'>;
  whitelist?: Array<RegExp | string | ((input: string) => boolean)>;
  blacklist?: Array<RegExp | string | ((input: string) => boolean)>;
  root?: ParentNode | null;
  combineWithinSelector?: boolean;
  combineBetweenSelectors?: boolean;
  includeTag?: boolean;
  maxCombinations?: number;
  maxCandidates?: number;
}

// CSS-in-JS class name patterns to blacklist
const CSS_IN_JS_PATTERNS = [
  /^css-/, // Emotion
  /^sc-/, // styled-components
  /^jss\d+/, // JSS
  /^makeStyles-/, // Material-UI
  /^MuiButtonBase-/, // Material-UI
  /^Mui[A-Z]/, // Material-UI components
  /^chakra-/, // Chakra UI
  /^_[a-zA-Z0-9]+_[a-zA-Z0-9]+/, // CSS modules hashes
  /^[a-zA-Z]+__[a-zA-Z]+-[a-zA-Z0-9]+/, // BEM with hash
];

/**
 * Check if a class name is a CSS-in-JS hash that should be ignored
 */
function isCssInJsClass(className: string): boolean {
  return CSS_IN_JS_PATTERNS.some((pattern) => pattern.test(className));
}

/**
 * Element metadata extracted during selector generation
 */
export interface ElementMetadata {
  tagName: string;
  text?: string;
  ariaLabel?: string;
  role?: string;
  dataTestId?: string;
  type?: string;
  name?: string;
  placeholder?: string;
  dataState?: string;
  ariaChecked?: string;
  nearbyLabel?: string;
}

/**
 * Extract metadata about an element for step description
 */
export function getElementMetadata(element: Element): ElementMetadata {
  const htmlElement = element as HTMLElement;

  const metadata: ElementMetadata = {
    tagName: element.tagName.toLowerCase(),
  };

  // Get text content (truncated)
  const textContent = htmlElement.textContent?.trim();
  if (textContent && textContent.length > 0) {
    metadata.text = textContent.length > 50 ? textContent.substring(0, 50) + '...' : textContent;
  }

  // Get ARIA attributes
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    metadata.ariaLabel = ariaLabel;
  }

  const role = element.getAttribute('role');
  if (role) {
    metadata.role = role;
  }

  // Get data-testid
  const dataTestId = element.getAttribute('data-testid');
  if (dataTestId) {
    metadata.dataTestId = dataTestId;
  }

  // Check parent for role/aria (toggle switches often have role on parent)
  const parent = element.parentElement;
  if (parent) {
    const parentRole = parent.getAttribute('role');
    if (parentRole && !role) {
      metadata.role = parentRole;
    }
    const parentAriaLabel = parent.getAttribute('aria-label');
    if (parentAriaLabel && !ariaLabel) {
      metadata.ariaLabel = parentAriaLabel;
    }
  }

  // Capture data-state (used by Radix/shadcn toggles)
  const dataState = element.getAttribute('data-state');
  if (dataState) {
    metadata.dataState = dataState;
  }

  // Capture aria-checked (standard toggle attribute)
  const ariaChecked = element.getAttribute('aria-checked');
  if (ariaChecked) {
    metadata.ariaChecked = ariaChecked;
  }

  // For bare spans/divs with no text, look for sibling label text
  const tagName = element.tagName.toLowerCase();
  if (!metadata.text && (tagName === 'span' || tagName === 'div')) {
    const siblingLabel = parent?.querySelector('label, [class*="label"]');
    if (siblingLabel?.textContent?.trim()) {
      metadata.nearbyLabel = siblingLabel.textContent.trim().slice(0, 50);
    }
  }

  // Get input-specific attributes
  if (element.tagName === 'INPUT') {
    const input = element as HTMLInputElement;
    if (input.type) metadata.type = input.type;
    if (input.name) metadata.name = input.name;
    if (input.placeholder) metadata.placeholder = input.placeholder;
  }

  if (element.tagName === 'TEXTAREA') {
    const textarea = element as HTMLTextAreaElement;
    if (textarea.name) metadata.name = textarea.name;
    if (textarea.placeholder) metadata.placeholder = textarea.placeholder;
  }

  return metadata;
}

/**
 * Generate a stable CSS selector for an element
 * Prioritizes data-testid > id > aria-label > CSS
 */
export function generateSelector(element: Element): string {
  // 1. Highest priority: data-testid
  const testId = element.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  // 2. Check for unique id (that isn't a CSS-in-JS hash)
  const id = element.getAttribute('id');
  if (id && !isCssInJsClass(id)) {
    // Verify id is unique in document
    try {
      const matches = document.querySelectorAll(`#${CSS.escape(id)}`);
      if (matches.length === 1) {
        return `#${CSS.escape(id)}`;
      }
    } catch {
      // Invalid selector, fall through
    }
  }

  // 3. aria-label with tag or role
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const role = element.getAttribute('role');
    if (role) {
      const selector = `[role="${role}"][aria-label="${CSS.escape(ariaLabel)}"]`;
      try {
        const matches = document.querySelectorAll(selector);
        if (matches.length === 1) {
          return selector;
        }
      } catch {
        // Fall through
      }
    }

    const tagSelector = `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
    try {
      const matches = document.querySelectorAll(tagSelector);
      if (matches.length === 1) {
        return tagSelector;
      }
    } catch {
      // Fall through
    }
  }

  // 4. Use css-selector-generator with blacklisted patterns
  const options: SelectorOptions = {
    root: document,
    blacklist: [
      // Blacklist CSS-in-JS patterns
      (input: string) => {
        if (input.startsWith('.')) {
          const className = input.slice(1);
          return isCssInJsClass(className);
        }
        return false;
      },
    ],
    // Prefer IDs and tag selectors
    selectors: ['id', 'tag', 'nthchild'],
    includeTag: true,
    maxCombinations: 100,
    maxCandidates: 1000,
  };

  try {
    return getCssSelector(element, options);
  } catch (error) {
    console.warn('Failed to generate selector, using fallback:', error);
    // Ultimate fallback: tag + nth-child path
    return generateFallbackSelector(element);
  }
}

/**
 * Get truncated parent outerHTML for DOM context
 */
export function getParentOuterHTML(element: Element, levels: number = 2, maxLength: number = 500): string {
  let current: Element | null = element;
  for (let i = 0; i < levels; i++) {
    if (current?.parentElement && current.parentElement !== document.body) {
      current = current.parentElement;
    }
  }
  if (!current) return '';
  const html = current.outerHTML;
  return html.length > maxLength ? html.slice(0, maxLength) + '...' : html;
}

/**
 * Get visible text from sibling elements for context
 */
export function getNearbyVisibleText(element: Element, maxLength: number = 200): string {
  const parent = element.parentElement;
  if (!parent) return '';

  const texts: string[] = [];
  for (const child of Array.from(parent.children)) {
    const text = (child as HTMLElement).textContent?.trim();
    if (text && text.length > 0 && text.length < 100) {
      texts.push(text);
    }
  }
  const result = texts.join(' | ');
  return result.length > maxLength ? result.slice(0, maxLength) + '...' : result;
}

/**
 * Get the nearest heading context (h1/h2/h3)
 */
export function getCurrentHeadingContext(): string {
  const headings = document.querySelectorAll('h1, h2, h3');
  if (headings.length === 0) return '';
  // Return the last heading (most likely the current section)
  const lastHeading = headings[headings.length - 1];
  return (lastHeading as HTMLElement).textContent?.trim()?.slice(0, 100) || '';
}

/**
 * Generate a fallback selector using element path
 */
function generateFallbackSelector(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body && path.length < 10) {
    let selector = current.tagName.toLowerCase();

    // Add nth-child if there are siblings of same type
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}
