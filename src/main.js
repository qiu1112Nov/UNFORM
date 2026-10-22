import './style.css';
import { ParticleField } from './particles.js';
import { HandCamera } from './camera.js';
import { MOTION } from './motion.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#particle-field');
const status = $('#status');
let field;
try { field = new ParticleField(canvas); }
catch { status.textContent = 'Canvas 2D is unavailable. Please use a modern browser with graphics support.'; }

if (field) {
  const range = $('#dispersion');
  const syncParameters = () => {
    range.value = Math.round(field.dispersion * 100);
    $('#dispersion-value').value = `${range.value}%`;
    $('#motion-profile').textContent = `${MOTION.dynamicStyle} / HYBRID · INERTIA ${Math.round(field.inertia * 100)}%`;
  };
  syncParameters();
  const pause = $('#pause');
  const inputMode = $('#input-mode');
  const pointerMode = matchMedia('(pointer: coarse)').matches ? 'TOUCH MODE' : 'POINTER MODE';
  inputMode.textContent = pointerMode;
  const captions = { octahedron: '06 VERTICES / 12 EDGES / 08 FACES', circle: 'ORBITAL FORM', lines: 'WAVE STUDY', grid: 'CARTESIAN FIELD' };
  const setForm = form => {
    field.setForm(form);
    document.querySelectorAll('.form-button').forEach(button => {
      const active = button.dataset.form === form;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', active);
    });
    $('#form-caption').textContent = captions[form];
    if (field.paused) { field.update(1); field.draw(); }
  };
  document.querySelectorAll('.form-button').forEach(button => button.addEventListener('click', () => setForm(button.dataset.form)));
  range.addEventListener('input', () => {
    field.dispersion = Number(range.value) / 100;
    $('#dispersion-value').value = `${range.value}%`;
    if (field.paused) { field.update(1); field.draw(); }
  });
  const syncPause = () => {
    pause.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${field.paused ? '<path d="m8 4 12 8-12 8Z"/>' : '<path d="M8 5v14M16 5v14"/>'}</svg>`;
    pause.setAttribute('aria-label', field.paused ? 'Play animation' : 'Pause animation');
    pause.title = field.paused ? 'Play animation' : 'Pause animation';
    pause.setAttribute('aria-pressed', field.paused);
  };
  syncPause();
  if (field.reducedMotion) status.textContent = 'Reduced motion: artwork paused. Press play to animate.';
  pause.addEventListener('click', () => { field.paused = !field.paused; field.last = 0; field.quality.resetTiming(); syncPause(); });
  $('#reset').addEventListener('click', () => {
    field.reset(); setForm('octahedron'); syncParameters();
    if (field.paused) { field.update(1); field.draw(); }
    status.textContent = 'Hold to weave. Swipe to unravel. Release to reform.';
    field.resize();
  });
  window.addEventListener('keydown', event => {
    if (event.target.closest('button,input,a,textarea,select,[contenteditable]') || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === 'Space') { event.preventDefault(); pause.click(); }
    if (['1', '2', '3', '4'].includes(event.key)) setForm(['octahedron', 'lines', 'circle', 'grid'][Number(event.key) - 1]);
  });
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    field.pointerDown(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  });
  canvas.addEventListener('pointermove', event => {
    field.pointerMove(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  });
  canvas.addEventListener('pointerup', event => field.pointerUp(event.pointerId));
  for (const name of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => {
    if (field.pointers.has(event.pointerId)) field.pointerUp(event.pointerId, true);
  });
  canvas.addEventListener('pointerleave', () => { if (!field.pointers.size) field.focus = null; });
  window.addEventListener('blur', () => field.clearPointers());
  // Avoid the native long-press menu interrupting a weave on mobile browsers.
  canvas.addEventListener('contextmenu', event => event.preventDefault());

  const cameraButton = $('#camera-toggle');
  const camera = new HandCamera($('#camera-video'), (state, message) => {
    if (state !== 'active') field.inferenceMs = null;
    const enabled = state === 'loading' || state === 'active';
    cameraButton.setAttribute('aria-pressed', enabled);
    $('#camera-label').textContent = state === 'loading' ? 'Cancel camera' : state === 'active' ? 'Disable camera' : 'Enable camera';
    $('#camera-monitor').hidden = state !== 'active';
    inputMode.textContent = state === 'active' ? 'HAND TRACKING' : pointerMode;
    status.textContent = message;
    requestAnimationFrame(field.resize);
  }, hand => {
    field.inferenceMs = camera.metrics.inferenceMs;
    // Position filtering and confirmation run once upstream. Do not add an
    // openness EMA here: it delays both the trend and the spring response.
    field.setHand(hand);
    $('#hand-status').textContent = !hand ? 'LOOKING FOR A HAND' : hand.openness > 0.55 ? 'OPEN PALM / DISPERSE' : 'CLOSED HAND / GATHER';
  });
  field.onGestureRendered = sample => camera.metrics.rendered(sample);
  const debugMode = new URLSearchParams(location.search).get('debug');
  if (debugMode === 'gestures' || debugMode === 'performance') {
    const panel = document.createElement('details');
    panel.className = 'gesture-debug'; panel.open = true;
    const heading = document.createElement('summary'); heading.textContent = debugMode === 'performance' ? 'MOBILE PERFORMANCE' : 'GESTURE TIMING';
    const text = document.createElement('pre'); panel.append(heading, text);
    document.body.append(panel);
    const ms = value => value === null ? '—' : `${value.toFixed(1)} ms`;
    const timer = setInterval(() => {
      const metrics = camera.metrics.snapshot(performance.now());
      text.textContent = debugMode === 'performance'
        ? `FPS: ${(field.paused ? 0 : field.quality.fps).toFixed(1)}\nParticles: ${field.budget.length} visible / ${field.count} target / ${field.poolCount} pooled\nUpdate: ${ms(field.quality.updateMs)}\nDraw submission: ${ms(field.quality.drawMs)}\nMain work EMA: ${ms(field.quality.workEMA)}\nDPR: ${field.dpr.toFixed(2)} / quality: ${field.mobile ? field.quality.level : 'desktop'}\nTRACE samples: ${field.trace.samples}\nInference: ${ms(metrics.inferenceMs)} / ${camera.inferenceMode}\nCamera: ${metrics.cameraFPS.toFixed(1)} fps / inference: ${metrics.inferenceFPS.toFixed(1)} fps\n*CPU/Canvas submission; excludes display/compositor cost`
        : `Delivered camera: ${metrics.cameraFPS.toFixed(1)} fps\nInference: ${metrics.inferenceFPS.toFixed(1)} fps / ${ms(metrics.inferenceMs)}\nMode: ${camera.inferenceMode}\nConfirmation: ${ms(metrics.confirmationMs)}\nAnimation start*: ${ms(metrics.animationStartMs)}\nDispatch → draw*: ${ms(metrics.renderQueueMs)}\nState: ${metrics.stage}${field.paused ? ' / paused' : ''}\n*Canvas proxy; not physical capture-to-display latency`;
    }, 250);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  }
  cameraButton.addEventListener('click', () => { if (camera.requested) camera.stop(); else camera.start(); });
  // Release camera hardware when leaving or hiding the page. Resume is explicit.
  window.addEventListener('pagehide', () => camera.stop());
  document.addEventListener('visibilitychange', () => { if (document.hidden && camera.requested) camera.stop('Camera paused while away. Enable it to resume.'); });

  const guide = $('#guide');
  const guideButton = $('#guide-toggle');
  const showGuide = show => { guide.hidden = !show; guideButton.setAttribute('aria-expanded', show); };
  guideButton.addEventListener('click', () => showGuide(guide.hidden));
  $('#guide-close').addEventListener('click', () => { showGuide(false); guideButton.focus(); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && !guide.hidden) { showGuide(false); guideButton.focus(); } });
  requestAnimationFrame(field.resize);
}
