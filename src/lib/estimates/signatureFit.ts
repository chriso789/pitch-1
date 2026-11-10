/**
 * Signature lines must be fully visible inside their page's content area.
 * Estimate pages clip overflowing content, so a line that falls below the
 * content box would be invisible in the PDF and its stored anchor unusable.
 */
export function findClippedSignatureLine(root: ParentNode): HTMLElement | null {
  const lines = root.querySelectorAll<HTMLElement>('[data-signature-line], [data-date-line]');
  for (const line of Array.from(lines)) {
    const box =
      line.closest<HTMLElement>('[data-page-content]') ||
      line.closest<HTMLElement>('[data-report-page]');
    if (!box) continue;
    const area = box.getBoundingClientRect();
    if (area.height === 0 || area.width === 0) continue; // not laid out (hidden)
    const rect = line.getBoundingClientRect();
    if (rect.bottom > area.bottom + 0.5 || rect.top < area.top - 0.5 || rect.right > area.right + 0.5) {
      return line;
    }
  }
  return null;
}

export const SIGNATURE_FIT_ERROR =
  "The signature lines don't fit on the estimate page, so this PDF was not created. Shorten the scope or fine print and try again.";
