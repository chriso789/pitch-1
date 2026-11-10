import { describe, expect, it } from 'vitest';
import { findClippedSignatureLine } from '@/lib/estimates/signatureFit';

function rect(top: number, bottom: number, left = 0, right = 700): DOMRect {
  return { top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function page(contentBottom: number, lineBottom: number) {
  const root = document.createElement('div');
  root.innerHTML = '<div data-report-page><div data-page-content><div data-signature-line="customer"></div></div></div>';
  const content = root.querySelector('[data-page-content]') as HTMLElement;
  const line = root.querySelector('[data-signature-line]') as HTMLElement;
  content.getBoundingClientRect = () => rect(90, contentBottom);
  line.getBoundingClientRect = () => rect(lineBottom - 20, lineBottom, 20, 400);
  return root;
}

describe('estimate signature lines', () => {
  it('flags a signature line that falls below the page content area', () => {
    expect(findClippedSignatureLine(page(970, 1040))).not.toBeNull();
  });

  it('accepts a signature line fully inside the page content area', () => {
    expect(findClippedSignatureLine(page(970, 700))).toBeNull();
  });

  it('ignores pages that are not laid out yet', () => {
    expect(findClippedSignatureLine(page(90, 1040))).toBeNull();
  });
});
