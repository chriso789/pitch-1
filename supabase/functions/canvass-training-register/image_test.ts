import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { originalImageIdentity } from './image.ts';

Deno.test('hash original bytes and dimensions without modifying source', async () => {
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='), (v) => v.charCodeAt(0));
  const before = bytes.slice();
  const identity = await originalImageIdentity(bytes);
  assertEquals(identity.w, 1); assertEquals(identity.h, 1);
  assertEquals(identity.hash.length, 64); assertEquals(bytes, before);
  assertEquals(await originalImageIdentity(bytes), identity);
});
Deno.test('invalid image cannot enter trusted intake', async () => {
  await assertRejects(() => originalImageIdentity(new Uint8Array([1, 2, 3])));
});