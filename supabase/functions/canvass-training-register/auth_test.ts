import { assertEquals } from 'jsr:@std/assert';
import { app } from './index.ts';

Deno.test('anonymous registration cannot read or register a tenant photo', async () => {
  const response = await app.fetch(new Request('http://localhost/canvass-training-register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoId: '00000000-0000-4000-8000-000000000001' }) }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).ok, false);
  assertEquals(response.headers.get('Access-Control-Allow-Headers')?.includes('x-pitch-tenant'), true);
});
Deno.test('preflight supports selected-company header', async () => {
  const response = await app.fetch(new Request('http://localhost/canvass-training-register', { method: 'OPTIONS' }));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('Access-Control-Allow-Headers')?.includes('x-pitch-tenant'), true);
});