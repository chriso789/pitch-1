import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { Image } from 'npm:imagescript@1.3.0';
import { originalImageIdentity } from './image.ts';

Deno.test('hash original bytes and dimensions without modifying source', async () => {
  const image = new Image(8, 6); image.fill(0xff0000ff);
  const bytes = await image.encode(); const before = bytes.slice();
  const identity = await originalImageIdentity(bytes);
  assertEquals(identity.w, 8); assertEquals(identity.h, 6);
  assertEquals(identity.hash.length, 64); assertEquals(bytes, before);
  assertEquals(await originalImageIdentity(bytes), identity);
});
Deno.test('invalid image cannot enter trusted intake', async () => {
  await assertRejects(() => originalImageIdentity(new Uint8Array([1, 2, 3])));
});