import './style.css';
import { ParticleField } from './particles.js';
import { HandCamera } from './camera.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#particle-field');
const status = $('#status');
let field;
try { field = new ParticleField(canvas); }
catch { status.textContent = 'Canvas 2D is unavailable. Please use a modern browser with graphics support.'; }

if (field) {
  const range = $('#dispersion');
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
  pause.addEventListener('click', () => { field.paused = !field.paused; syncPause(); });
  $('#reset').addEventListener('click', () => {
    field.reset(); setForm('octahedron'); range.value = 6; $('#dispersion-value').value = '6%';
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
    const enabled = state === 'loading' || state === 'active';
    cameraButton.setAttribute('aria-pressed', enabled);
    $('#camera-label').textContent = state === 'loading' ? 'Cancel camera' : state === 'active' ? 'Disable camera' : 'Enable camera';
    $('#camera-monitor').hidden = state !== 'active';
    inputMode.textContent = state === 'active' ? 'HAND TRACKING' : pointerMode;
    status.textContent = message;
    requestAnimationFrame(field.resize);
  }, hand => {
    // Light smoothing reduces landmark jitter; lost hands immediately release control.
    const previous = field.hand;
    field.hand = hand && previous ? { x: previous.x * 0.6 + hand.x * 0.4, y: previous.y * 0.6 + hand.y * 0.4, openness: previous.openness * 0.6 + hand.openness * 0.4 } : hand;
    $('#hand-status').textContent = !hand ? 'LOOKING FOR A HAND' : hand.openness > 0.55 ? 'OPEN PALM / DISPERSE' : 'CLOSED HAND / GATHER';
  });
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
