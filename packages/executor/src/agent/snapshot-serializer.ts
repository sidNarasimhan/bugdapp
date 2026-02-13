import type { Page } from 'playwright-core';
import type { SnapshotNode } from './types.js';

interface AccessibilityNode {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean | 'mixed';
  selected?: boolean;
  children?: AccessibilityNode[];
}

/**
 * Captures the page's accessibility tree and serializes it to a ref-tagged
 * text format suitable for the agent. Returns the text and a map of refs
 * to snapshot nodes (for resolving tool calls).
 */
export async function captureSnapshot(
  page: Page
): Promise<{ text: string; refs: Map<string, SnapshotNode> }> {
  let snapshot: AccessibilityNode | null = null;

  // Method 1: Try Playwright's accessibility.snapshot() API
  try {
    const accessibilityApi = (page as any).accessibility;
    if (accessibilityApi && typeof accessibilityApi.snapshot === 'function') {
      snapshot = await accessibilityApi.snapshot({ interestingOnly: true });
    }
  } catch {
    // Not available in this Playwright version
  }

  // Method 2: Fall back to CDP (Chrome DevTools Protocol)
  if (!snapshot) {
    try {
      snapshot = await getAccessibilityTreeViaCDP(page);
    } catch (cdpError) {
      // CDP also failed
      console.warn('[SnapshotSerializer] CDP accessibility fallback failed:', cdpError);
    }
  }

  if (!snapshot) {
    return { text: '[page] (empty or inaccessible)', refs: new Map() };
  }

  const refs = new Map<string, SnapshotNode>();
  let refCounter = 0;

  function nextRef(): string {
    return `e${++refCounter}`;
  }

  function serialize(node: AccessibilityNode, depth: number): string {
    const indent = '  '.repeat(depth);
    const role = node.role;
    const name = node.name || '';

    // Skip generic/structural nodes without useful info
    if (role === 'none' || role === 'generic' || role === 'GenericContainer' || role === 'ignored') {
      // Still process children
      if (node.children) {
        return node.children.map((c) => serialize(c, depth)).filter(Boolean).join('\n');
      }
      return '';
    }

    // Assign a ref to interactive/identifiable elements
    const isInteractive = [
      'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
      'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'searchbox',
      'option', 'menuitemcheckbox', 'menuitemradio', 'treeitem',
    ].includes(role);

    const isLandmark = ['heading', 'dialog', 'alert', 'alertdialog', 'banner',
      'navigation', 'main', 'complementary', 'contentinfo', 'form', 'region',
      'status', 'img', 'figure', 'table', 'row', 'cell', 'list', 'listitem',
      'WebArea',
    ].includes(role);

    let ref = '';
    if (isInteractive || isLandmark) {
      ref = nextRef();

      // Build locator strategy for this element
      let locatorStrategy: string;
      if (isInteractive && name) {
        locatorStrategy = `getByRole('${role}', { name: ${JSON.stringify(name)} })`;
      } else if (name) {
        locatorStrategy = `getByRole('${role}', { name: ${JSON.stringify(name)} })`;
      } else {
        locatorStrategy = `getByRole('${role}')`;
      }

      refs.set(ref, { role, name, ref, locatorStrategy });
    }

    // Build the line
    let line = indent;
    if (ref) {
      line += `[${ref}] `;
    }
    line += role;
    if (name) {
      line += ` "${name}"`;
    }

    // Add state annotations
    const states: string[] = [];
    if (node.checked === true) states.push('checked');
    if (node.checked === 'mixed') states.push('mixed');
    if (node.disabled) states.push('disabled');
    if (node.expanded === true) states.push('expanded');
    if (node.expanded === false) states.push('collapsed');
    if (node.pressed === true) states.push('pressed');
    if (node.selected) states.push('selected');
    if (node.value) states.push(`value="${node.value}"`);

    if (states.length > 0) {
      line += ` (${states.join(', ')})`;
    }

    const lines = [line];

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        const childText = serialize(child, depth + 1);
        if (childText) {
          lines.push(childText);
        }
      }
    }

    return lines.join('\n');
  }

  const text = serialize(snapshot, 0);

  // Add page URL as context
  const url = page.url();
  const title = await page.title();
  const header = `[page] "${title}" (${url})`;

  return {
    text: `${header}\n${text}`,
    refs,
  };
}

// ============================================================================
// CDP Fallback: Get accessibility tree via Chrome DevTools Protocol
// ============================================================================

interface CDPNode {
  nodeId: string;
  ignored: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: string };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

async function getAccessibilityTreeViaCDP(page: Page): Promise<AccessibilityNode | null> {
  const client = await page.context().newCDPSession(page);

  try {
    const { nodes } = await client.send('Accessibility.getFullAXTree') as { nodes: CDPNode[] };

    if (!nodes || nodes.length === 0) {
      return null;
    }

    // Build a map of nodeId -> CDPNode
    const nodeMap = new Map<string, CDPNode>();
    for (const node of nodes) {
      nodeMap.set(node.nodeId, node);
    }

    // Find root node (first non-ignored node, typically the WebArea)
    const rootNode = nodes.find(n => !n.ignored && n.role?.value === 'WebArea')
      || nodes.find(n => !n.ignored);

    if (!rootNode) {
      return null;
    }

    // Recursively convert CDP nodes to our AccessibilityNode format
    function convert(cdpNode: CDPNode): AccessibilityNode | null {
      if (cdpNode.ignored) {
        // Still process children for ignored nodes
        const children: AccessibilityNode[] = [];
        if (cdpNode.childIds) {
          for (const childId of cdpNode.childIds) {
            const child = nodeMap.get(childId);
            if (child) {
              const converted = convert(child);
              if (converted) children.push(converted);
            }
          }
        }
        if (children.length === 1) return children[0];
        if (children.length > 1) {
          return { role: 'none', children };
        }
        return null;
      }

      const role = cdpNode.role?.value || 'none';
      const name = cdpNode.name?.value || '';

      // Skip static text nodes with no interesting content
      if (role === 'StaticText' || role === 'InlineTextBox') {
        return null;
      }

      const result: AccessibilityNode = { role: normalizeRole(role) };
      if (name) result.name = name;

      // Extract value
      if (cdpNode.value?.value) {
        result.value = String(cdpNode.value.value);
      }

      // Extract properties
      if (cdpNode.properties) {
        for (const prop of cdpNode.properties) {
          switch (prop.name) {
            case 'checked':
              result.checked = prop.value.value === 'mixed' ? 'mixed' : prop.value.value === true;
              break;
            case 'disabled':
              result.disabled = prop.value.value === true;
              break;
            case 'expanded':
              result.expanded = prop.value.value === true;
              break;
            case 'pressed':
              result.pressed = prop.value.value === 'mixed' ? 'mixed' : prop.value.value === true;
              break;
            case 'selected':
              result.selected = prop.value.value === true;
              break;
          }
        }
      }

      // Convert children
      if (cdpNode.childIds && cdpNode.childIds.length > 0) {
        const children: AccessibilityNode[] = [];
        for (const childId of cdpNode.childIds) {
          const child = nodeMap.get(childId);
          if (child) {
            const converted = convert(child);
            if (converted) children.push(converted);
          }
        }
        if (children.length > 0) {
          result.children = children;
        }
      }

      return result;
    }

    return convert(rootNode);
  } finally {
    try {
      await client.detach();
    } catch {
      // Already detached
    }
  }
}

/**
 * Normalize CDP role names to Playwright-style role names
 */
function normalizeRole(cdpRole: string): string {
  const roleMap: Record<string, string> = {
    'WebArea': 'WebArea',
    'RootWebArea': 'WebArea',
    'Abbr': 'text',
    'AlertDialog': 'alertdialog',
    'Application': 'application',
    'Article': 'article',
    'Banner': 'banner',
    'Blockquote': 'blockquote',
    'Button': 'button',
    'Caption': 'caption',
    'Cell': 'cell',
    'CheckBox': 'checkbox',
    'Code': 'code',
    'ColumnHeader': 'columnheader',
    'ComboBoxGrouping': 'combobox',
    'ComboBoxMenuButton': 'combobox',
    'Complementary': 'complementary',
    'ContentInfo': 'contentinfo',
    'Definition': 'definition',
    'Deletion': 'deletion',
    'Dialog': 'dialog',
    'Directory': 'directory',
    'DisclosureTriangle': 'button',
    'DocCover': 'img',
    'Document': 'document',
    'EmbeddedObject': 'img',
    'Emphasis': 'emphasis',
    'Feed': 'feed',
    'FigureCaption': 'caption',
    'Figure': 'figure',
    'Footer': 'contentinfo',
    'Form': 'form',
    'GenericContainer': 'generic',
    'Grid': 'grid',
    'Group': 'group',
    'Header': 'banner',
    'Heading': 'heading',
    'Iframe': 'region',
    'IframePresentational': 'none',
    'Image': 'img',
    'Img': 'img',
    'Insertion': 'insertion',
    'LabelText': 'text',
    'Legend': 'text',
    'LineBreak': 'none',
    'Link': 'link',
    'List': 'list',
    'ListBox': 'listbox',
    'ListBoxOption': 'option',
    'ListItem': 'listitem',
    'ListMarker': 'none',
    'Log': 'log',
    'Main': 'main',
    'Mark': 'mark',
    'Marquee': 'marquee',
    'Math': 'math',
    'Menu': 'menu',
    'MenuBar': 'menubar',
    'MenuButton': 'button',
    'MenuItem': 'menuitem',
    'MenuItemCheckBox': 'menuitemcheckbox',
    'MenuItemRadio': 'menuitemradio',
    'MenuListOption': 'option',
    'MenuListPopup': 'menu',
    'Meter': 'meter',
    'Navigation': 'navigation',
    'Note': 'note',
    'Paragraph': 'paragraph',
    'PopUpButton': 'combobox',
    'Pre': 'text',
    'ProgressIndicator': 'progressbar',
    'RadioButton': 'radio',
    'RadioGroup': 'radiogroup',
    'Region': 'region',
    'Row': 'row',
    'RowHeader': 'rowheader',
    'ScrollBar': 'scrollbar',
    'Search': 'search',
    'SearchBox': 'searchbox',
    'Section': 'region',
    'Slider': 'slider',
    'SpinButton': 'spinbutton',
    'Splitter': 'separator',
    'Status': 'status',
    'Strong': 'strong',
    'Subscript': 'subscript',
    'Suggestion': 'text',
    'Superscript': 'superscript',
    'Switch': 'switch',
    'Tab': 'tab',
    'TabList': 'tablist',
    'TabPanel': 'tabpanel',
    'Table': 'table',
    'Term': 'term',
    'TextField': 'textbox',
    'Time': 'time',
    'Timer': 'timer',
    'ToggleButton': 'button',
    'Toolbar': 'toolbar',
    'Tooltip': 'tooltip',
    'Tree': 'tree',
    'TreeGrid': 'treegrid',
    'TreeItem': 'treeitem',
    'Video': 'video',
  };

  return roleMap[cdpRole] || cdpRole.toLowerCase();
}
