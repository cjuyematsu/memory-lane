import React from 'react';
import TestRenderer from 'react-test-renderer';

// `mock`-prefixed so jest allows referencing them inside the mock factory.
let mockProgress = { processed: 0, total: 0 };
let mockSub: (() => void) | null = null;

jest.mock('@/hooks/use-located-assets', () => ({
  getBuildProgress: () => mockProgress,
  subscribeBuildProgress: (cb: () => void) => {
    mockSub = cb;
    return () => {
      mockSub = null;
    };
  },
}));
// theme.ts imports global.css (unparseable by jest); stub the tokens this uses.
jest.mock('@/constants/theme', () => ({ DisplayFont: 'Font', Ink: '#111' }));

// Imported after the mocks/mock-vars it depends on (standard jest pattern).
// eslint-disable-next-line import/first
import { SetupNote } from '@/components/near-me/setup-note';

type Json = null | string | { children?: Json[] | null } | Json[];
function allText(node: Json): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(allText).join(' ');
  return allText(node.children ?? null);
}

describe('SetupNote', () => {
  beforeEach(() => {
    mockProgress = { processed: 0, total: 0 };
    mockSub = null;
  });

  it('renders the generic copy before the count starts, then the live count', () => {
    let tree: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      tree = TestRenderer.create(<SetupNote />);
    });

    let text = allText(tree!.toJSON() as Json);
    expect(text).toContain('Setting up Near Me');
    expect(text).toContain('This happens once');
    // Always points the user at the tab that already works.
    expect(text).toContain('Memories tab is ready');
    expect(text).not.toContain(' of ');

    // The index build pushes progress; the subscribed note re-renders with the
    // moving count — the "it's working" signal.
    mockProgress = { processed: 3200, total: 9800 };
    TestRenderer.act(() => {
      mockSub?.();
    });

    text = allText(tree!.toJSON() as Json);
    expect(text).toContain('3,200 of 9,800');
  });

  it('unsubscribes on unmount', () => {
    let tree: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      tree = TestRenderer.create(<SetupNote />);
    });
    expect(mockSub).not.toBeNull();
    TestRenderer.act(() => {
      tree!.unmount();
    });
    expect(mockSub).toBeNull();
  });
});
