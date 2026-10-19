export interface QueuedPhotoScope { tenantId: string; userId: string; retryCount: number }

/** Never drain another company's or another employee's local queue. */
export function queueForSession<T extends QueuedPhotoScope>(photos: T[], tenantId: string, userId: string): T[] {
  return photos.filter((p) => p.tenantId === tenantId && p.userId === userId);
}

/** A failed upload is retained, including its original metadata and bytes. */
export function retainFailedPhoto<T extends QueuedPhotoScope>(photo: T): T {
  return { ...photo, retryCount: photo.retryCount + 1 };
}