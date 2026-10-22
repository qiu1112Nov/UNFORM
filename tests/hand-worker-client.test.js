import test from 'node:test';
import assert from 'node:assert/strict';
import { HandWorkerClient } from '../src/hand-worker-client.js';

test('worker client correlates replies and rejects pending requests on cancellation', async () => {
  let packet, terminated = 0;
  const worker = { postMessage(value) { packet = value; }, terminate() { terminated++; } };
  const client = new HandWorkerClient(worker);
  const first = client.request('frame', { timestamp: 20 });
  worker.onmessage({ data: { id: packet.id, ok: true, inferenceMs: 12, landmarks: [] } });
  assert.equal((await first).inferenceMs, 12);
  const pending = client.request('frame', { timestamp: 40 });
  const rejected = assert.rejects(pending, /Worker stopped/);
  client.close(); client.close(); await rejected;
  assert.equal(terminated, 1); assert.equal(client.pending.size, 0);
});

test('a frame acquired after stop is closed without being sent to the worker', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let acquire, closed = 0, sent = 0;
  globalThis.createImageBitmap = () => new Promise(resolve => { acquire = resolve; });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous); else delete globalThis.createImageBitmap; });
  const client = new HandWorkerClient({ postMessage() { sent++; }, terminate() {} });
  const pending = client.detect({}, 20);
  const rejection = assert.rejects(pending, /Worker is closed/);
  client.close(); acquire({ close() { closed++; } });
  await rejection;
  assert.equal(sent, 0); assert.equal(closed, 1);
});

test('a Worker that never responds times out and is terminated for automatic backend recovery', async () => {
  let terminated = 0;
  const client = new HandWorkerClient({ postMessage() {}, terminate() { terminated++; } }, { frameTimeoutMs: 5 });
  await assert.rejects(client.request('frame', {}), /timed out/);
  assert.equal(terminated, 1); assert.equal(client.pending.size, 0);
});

test('a stalled ImageBitmap capture times out and closes a late bitmap', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let resolve, closed = 0;
  globalThis.createImageBitmap = () => new Promise(done => { resolve = done; });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous); else delete globalThis.createImageBitmap; });
  const client = new HandWorkerClient({ postMessage() {}, terminate() {} }, { frameTimeoutMs: 5 });
  await assert.rejects(client.detect({}, 0), /capture timed out/);
  resolve({ close() { closed++; } }); await Promise.resolve(); await Promise.resolve();
  assert.equal(closed, 1); assert.equal(client.closed, true);
});
