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

test('unknown origins cannot enter or initialize CREATE', () => {
  const { flow, events } = setup();
  for (const path of ['', 'geometry', null]) assert.equal(flow.choose(path), false);
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


test('FUSION opens IMPORT without initializing or modifying the GEOMETRY artwork', () => {
  const { flow, events } = setup();
  assert.equal(flow.choose('FUSION'), true);
  assert.equal(flow.screen, 'IMPORT'); assert.equal(flow.started, false);
  assert.equal(flow.choose('GEOMETRY'), false);
  assert.deepEqual(events, [['render', 'ORIGIN'], ['render', 'IMPORT']]);
  flow.back(); flow.choose('GEOMETRY'); flow.back(); flow.choose('FUSION'); flow.back(); flow.choose('GEOMETRY');
  assert.deepEqual(events.filter(e => e[0] === 'enter'), [['enter', true], ['enter', false]]);
});

test('only a prepared IMPORT can enter TRANSLATE; edit and cancel never enter CREATE', () => {
  const { flow, events } = setup();
  assert.equal(flow.translate(true), false); assert.equal(flow.editImage(), false);
  flow.choose('FUSION');
  assert.equal(flow.translate(false), false); assert.equal(flow.screen, 'IMPORT');
  assert.equal(flow.translate(true), true); assert.equal(flow.screen, 'TRANSLATE');
  assert.equal(flow.translate(true), false); assert.equal(flow.choose('GEOMETRY'), false);
  assert.equal(flow.editImage(), true); assert.equal(flow.screen, 'IMPORT');
  flow.translate(true); assert.equal(flow.back(), true); assert.equal(flow.screen, 'ORIGIN');
  assert.equal(events.some(e => ['enter', 'leave', 'confirm'].includes(e[0])), false);
});

test('confirmed FUSION enters CREATE once and both origin paths resume independently', () => {
  const { flow, events } = setup();
  assert.equal(flow.resumeFusion(), false);
  flow.choose('GEOMETRY'); flow.back(); assert.equal(flow.resumeFusion(), false);
  assert.equal(flow.createFusion({}), false);
  flow.choose('FUSION'); flow.translate(true);
  assert.equal(flow.createFusion(null), false);
  assert.equal(flow.createFusion({ kind: 'material' }), true);
  assert.equal(flow.path, 'FUSION'); assert.equal(flow.createFusion({}), false);
  flow.back(); assert.equal(flow.resumeFusion(), true); assert.equal(flow.path, 'FUSION');
  flow.back(); flow.choose('GEOMETRY'); assert.equal(flow.path, 'GEOMETRY');
  assert.equal(events.filter(e => e[0] === 'enter' && e[1] === true).length, 1);
});
