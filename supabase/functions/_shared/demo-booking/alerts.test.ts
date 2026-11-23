import { assertEquals } from 'jsr:@std/assert@1';
import { DEMO_ALERT_EMAIL } from './alerts.ts';

Deno.test('demo booking email alerts go to app@pitch-crm.ai', () => {
  assertEquals(DEMO_ALERT_EMAIL, 'app@pitch-crm.ai');
});
