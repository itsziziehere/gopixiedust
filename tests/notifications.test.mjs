import test from 'node:test';
import assert from 'node:assert/strict';
import { pushKeys, deliver, recordOwnerEvent, sendReminders, sendOwnerEvents } from '../netlify/lib/notifications.mjs';

test('notification module loads with the installed web-push exports', () => {
 for (const handler of [pushKeys, deliver, recordOwnerEvent, sendReminders, sendOwnerEvents]) {
  assert.equal(typeof handler, 'function');
 }
});
