import test from 'node:test';
import assert from 'node:assert/strict';
import { OriginFlow } from '../src/origin.js';

function setup({ dirty = false, confirm = true } = {}) {
  const events = [], state = { dirty, confirm };
  const flow = new OriginFlow({
    render: screen => events.push(['render', screen]),
    enter: first => events.push(['enter', first]),
    leave: () => events.push(['leave']),
    hasChanges: () => state.dirty,
    confirmReturn: () => { events.push(['confirm']); return state.confirm; },
  });
  return { flow, events, state };
}

test('first visit is ORIGIN without initializing CREATE; GEOMETRY shows CREATE before initializing', () => {
  const { flow, events } = setup();
  assert.equal(flow.screen, 'ORIGIN'); assert.equal(flow.started, false);
  assert.deepEqual(events, [['render', 'ORIGIN']]);
  assert.equal(flow.choose('GEOMETRY'), true);
  assert.equal(flow.screen, 'CREATE');
  assert.deepEqual(events.slice(1), [['render', 'CREATE'], ['enter', true]]);
  assert.equal(flow.choose('GEOMETRY'), false, 'a double tap cannot initialize twice');
});

test('FUSION and unknown origins cannot enter or initialize CREATE', () => {
  const { flow, events } = setup();
  for (const path of ['FUSION', '', 'geometry', null]) assert.equal(flow.choose(path), false);
  assert.equal(flow.screen, 'ORIGIN'); assert.deepEqual(events, [['render', 'ORIGIN']]);
});

test('canceling return with unsaved shape leaves CREATE and input lifecycle untouched', () => {
  const { flow, events, state } = setup({ dirty: true, confirm: false });
  flow.choose('GEOMETRY'); events.length = 0;
  assert.equal(flow.back(), false); assert.equal(flow.screen, 'CREATE');
  assert.deepEqual(events, [['confirm']]);
  state.confirm = true;
  assert.equal(flow.back(), true); assert.equal(flow.screen, 'ORIGIN');
  assert.deepEqual(events.slice(1), [['confirm'], ['leave'], ['render', 'ORIGIN']]);
});

test('clean return requires no dialog; reentry resumes instead of initializing another artwork', () => {
  const { flow, events } = setup();
  assert.equal(flow.back(), false);
  flow.choose('GEOMETRY'); flow.back(); flow.choose('GEOMETRY');
  assert.deepEqual(events.filter(e => e[0] === 'enter'), [['enter', true], ['enter', false]]);
  assert.equal(events.some(e => e[0] === 'confirm'), false);
});
