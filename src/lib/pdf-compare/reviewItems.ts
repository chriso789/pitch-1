import type { ChangeRegion } from './diff';

export type ReviewItemType = 'rfi' | 'change_order_review' | 'takeoff_task';
export const REVIEW_ITEM_LABELS: Record<ReviewItemType, string> = {
  rfi: 'RFI', change_order_review: 'Change-order review', takeoff_task: 'Takeoff task',
};

/** Human title locating a change area on the sheet (percent of sheet so it is resolution-independent). */
export function regionTitle(type: ReviewItemType, r: ChangeRegion, index: number, page: number, size: { w: number; h: number }): string {
  const px = (v: number, t: number) => Math.round((v / t) * 100);
  return `${REVIEW_ITEM_LABELS[type]}: ${r.kind} area #${index + 1}, page ${page} (${px(r.x, size.w)}% from left, ${px(r.y, size.h)}% from top)`.slice(0, 200);
}
