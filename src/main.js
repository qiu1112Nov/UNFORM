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
  const captions = { circle: 'FIG. 01 / ORBITAL FORM', lines: 'FIG. 02 / WAVE STUDY', grid: 'FIG. 03 / CARTESIAN FIELD' };
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
    field.reset(); setForm('circle'); range.value = 18; $('#dispersion-value').value = '18%';
    if (field.paused) { field.update(1); field.draw(); }
    status.textContent = 'Artwork reset. Move to disturb. Release to return.';
  });
  window.addEventListener('keydown', event => {
    if (event.target.closest('button,input,a,textarea,select,[contenteditable]') || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === 'Space') { event.preventDefault(); pause.click(); }
    if (['1', '2', '3'].includes(event.key)) setForm(['circle', 'lines', 'grid'][Number(event.key) - 1]);
  });
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    field.pointers.set(event.pointerId, point); field.focus = point;
  });
  canvas.addEventListener('pointermove', event => {
    const point = { x: event.clientX, y: event.clientY };
    if (field.pointers.has(event.pointerId)) field.pointers.set(event.pointerId, point);
    if (event.pointerType === 'mouse' || field.pointers.has(event.pointerId)) field.focus = point;
  });
  const release = event => {
    field.pointers.delete(event.pointerId);
    field.focus = field.pointers.size ? [...field.pointers.values()][0] : null;
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, release);
  canvas.addEventListener('pointerleave', () => { if (!field.pointers.size) field.focus = null; });
  window.addEventListener('blur', () => { field.pointers.clear(); field.focus = null; });

  const cameraButton = $('#camera-toggle');
  const camera = new HandCamera($('#camera-video'), (state, message) => {
    const enabled = state === 'loading' || state === 'active';
    cameraButton.setAttribute('aria-pressed', enabled);
    $('#camera-label').textContent = state === 'loading' ? 'Cancel camera' : state === 'active' ? 'Disable camera' : 'Enable camera';
    $('#camera-monitor').hidden = state !== 'active';
    inputMode.textContent = state === 'active' ? 'HAND TRACKING' : pointerMode;
    status.textContent = message;
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
}
