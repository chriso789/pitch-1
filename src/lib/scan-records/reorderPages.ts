/** Move one page to a new position, keeping every other page's relative order. */
export function reorderPages<T>(pages: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return pages;
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
