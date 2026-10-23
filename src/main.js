import './style.css';
import { ParticleField } from './particles.js';
import { HandCamera } from './camera.js';
import { gestureLabel } from './gesture-pipeline.js';
import { MOTION } from './motion.js';
import { IMPRINT } from './imprint.js';
import { OriginFlow } from './origin.js';
import { mountFusion } from './fusion.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#particle-field');
const status = $('#status');
let field, camera;
function releaseCaptures() {
  if (!field) return;
  for (const id of [...field.pointers.keys(), ...field.viewPointers.keys()]) {
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
}

function initializeCreate() {
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
  const syncMemory = () => { $('#undo').disabled = field.mode !== 'SCULPT' || !field.memory.commits.length; };
  field.onMemoryChange = action => {
    syncMemory();
    // History and Undo update on release. Only the visual acknowledgment waits
    // for the latest local spring to settle; no timer can overwrite newer input.
    if (action === 'COMMIT') return;
    status.textContent = action === 'SETTLED' ? `IMPRINT / Local shape remembered (${field.memory.commits.length}/${IMPRINT.maxCommits}).`
      : action === 'SCATTER' ? 'SCATTER / Release to reform. No imprint will be saved.'
      : action === 'SCATTER_END' ? 'SCULPT / Returning to your remembered form.'
      : action === 'INPUT' || action === 'CLEAR' ? 'SCULPT / Slow drag to shape. Swipe to scatter.'
      : action === 'UNDO' ? 'UNDO / Last imprint removed.'
      : action === 'LIMIT' ? 'IMPRINT / Memory is full. Undo or Restore to make room.' : 'RESTORE / Original form restored.';
  };
  $('#undo').addEventListener('click', () => { field.undoImprint(); });
  const pause = $('#pause');
  const inputMode = $('#input-mode');
  const pointerMode = matchMedia('(pointer: coarse)').matches ? 'TOUCH MODE' : 'POINTER MODE';
  inputMode.textContent = pointerMode;
  const captions = { octahedron: '06 VERTICES / 12 EDGES / 08 FACES', circle: 'ORBITAL FORM', lines: 'WAVE STUDY', grid: 'CARTESIAN FIELD' };
  const setForm = form => {
    if (field.setForm(form) === false) return;
    document.querySelectorAll('.form-button').forEach(button => {
      const active = button.dataset.form === form;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', active);
    });
    $('#form-caption').textContent = captions[form];
    if (field.paused) { field.update(1); field.draw(); }
  };
  document.querySelectorAll('.form-button').forEach(button => button.addEventListener('click', () => setForm(button.dataset.form)));
  range.addEventListener('input', () => {
    if (field.setDispersion(Number(range.value) / 100) === false) return;
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
  field.syncArtworkControls = () => { syncParameters(); syncPause(); syncMemory(); };
  if (field.reducedMotion) status.textContent = 'Reduced motion: artwork paused. Press play to animate.';
  pause.addEventListener('click', () => { field.paused = !field.paused; field.last = 0; field.quality.resetTiming(); syncPause(); });
  $('#reset').addEventListener('click', () => {
    if (field.reset() === false) return;
    setForm('octahedron'); syncParameters();
    if (field.paused) { field.update(1); field.draw(); }
    status.textContent = 'RESTORE / Original form restored. Drag to shape. Release to imprint.';
    field.resize();
  });
  window.addEventListener('keydown', event => {
    if (flow.screen !== 'CREATE') return;
    if (event.target.closest('button,input,a,textarea,select,[contenteditable]') || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === 'Space') { event.preventDefault(); pause.click(); }
    if (['1', '2', '3', '4'].includes(event.key)) setForm(['octahedron', 'lines', 'circle', 'grid'][Number(event.key) - 1]);
  });
  canvas.addEventListener('pointerdown', event => {
    if (flow.screen !== 'CREATE') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    field.pointerDown(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  });
  canvas.addEventListener('pointermove', event => {
    field.pointerMove(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  });
  canvas.addEventListener('pointerup', event => {
    // Some touch devices coalesce the final move into pointerup.
    field.pointerMove(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    field.pointerUp(event.pointerId);
  });
  for (const name of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => {
    if (field.pointers.has(event.pointerId) || field.viewPointers.has(event.pointerId)) field.pointerUp(event.pointerId, true);
  });
  canvas.addEventListener('pointerleave', () => { if (!field.pointers.size) field.focus = null; });
  window.addEventListener('blur', () => field.clearPointers());
  // Avoid the native long-press menu interrupting a weave on mobile browsers.
  canvas.addEventListener('contextmenu', event => event.preventDefault());

  const cameraButton = $('#camera-toggle');
  camera = new HandCamera($('#camera-video'), (state, message) => {
    if (state !== 'active') { field.inferenceMs = null; field.quality.recognitionPriority = false; }
    const enabled = state === 'loading' || state === 'active';
    cameraButton.setAttribute('aria-pressed', enabled);
    $('#camera-label').textContent = state === 'loading' ? 'Cancel camera' : state === 'active' ? 'Disable camera' : 'Enable camera';
    $('#camera-monitor').hidden = state !== 'active';
    inputMode.textContent = state === 'active' ? 'HAND TRACKING' : pointerMode;
    status.textContent = message;
    requestAnimationFrame(field.resize);
  }, hand => {
    field.inferenceMs = camera.metrics.inferenceMs;
    field.quality.recognitionPriority = field.mode === 'SCULPT' && field.mobile && camera.active && camera.inputQuality.level > 0;
    // Position filtering and confirmation run once upstream. Do not add an
    // openness EMA here: it delays both the trend and the spring response.
    field.setHand(hand);
    const label = gestureLabel(hand);
    if ($('#hand-status').textContent !== label) $('#hand-status').textContent = label;
  }, { mobile: field.mobile, renderStats: () => field.quality });
  const modeButtons = document.querySelectorAll('[data-mode]');
  modeButtons.forEach(button => button.addEventListener('click', () => {
    if (button.dataset.mode === field.mode) return;
    // End captures before discarding the associated pointer sessions. A held
    // finger/mouse must lift and press again after changing modes.
    releaseCaptures();
    field.setMode(button.dataset.mode);
    camera.resetGestureInput();
    field.quality.recognitionPriority = false;
    syncMemory();
    modeButtons.forEach(control => control.setAttribute('aria-pressed', control.dataset.mode === field.mode));
    const viewing = field.mode === 'VIEW';
    document.body.dataset.mode = field.mode;
    document.querySelectorAll('.form-button, #dispersion, #reset').forEach(control => { control.disabled = viewing; });
    status.textContent = viewing ? 'VIEW / Drag to look around. Your form is held.' : 'SCULPT / Begin a new input. Drag to shape. Release to imprint.';
  }));
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
      const diagnostic = camera.diagnostics();
      const fidelity = `\nMode: ${field.mode}${field.sculptHeld ? ' / form held' : ''}\nGesture: ${camera.response.confirmed === null ? 'unknown' : camera.response.confirmed ? 'open' : 'fist'} / ${camera.response.stage}\nTarget deconstruction: ${(field.targetActivation * field.dispersion * 100).toFixed(1)}%\nMotion: ${field.fragments.previewGoal === null ? 'formal' : 'preview'} / same layer springs\nActual layers: ${field.fragments.states.map(s => (s.value * field.dispersion * 100).toFixed(1)).join(' / ')}%\nCamera/model/inference: ${diagnostic.camera} / ${diagnostic.model} / ${diagnostic.inference}\nVideo ready/time: ${diagnostic.readyState} / ${Number(diagnostic.mediaTime).toFixed(3)}s\nFacing: requested user / actual ${diagnostic.facingMode}\nHand detected: ${diagnostic.hasHand} / last success: ${diagnostic.lastRecognitionAt === null ? 'never' : ((performance.now() - diagnostic.lastRecognitionAt) / 1000).toFixed(1) + 's ago'}\nError/fallback reason: ${diagnostic.error || 'none'}`;
      const inferenceDetails = `\nInput: ${camera.input?.width ?? 0}×${camera.input?.height ?? 0} / camera ${camera.sourceWidth}×${camera.sourceHeight}\nCapture + bitmap: ${ms(camera.captureMs)}\nFrame → result: ${ms(camera.roundTripMs)}\nPacing interval: ${ms(camera.pump?.intervalMs ?? null)} / in flight: ${camera.pump?.busy ? 1 : 0}`;
      text.textContent = debugMode === 'performance'
        ? `FPS: ${(field.paused ? 0 : field.quality.fps).toFixed(1)}\nParticles: ${field.budget.length} visible / ${field.count} target / ${field.poolCount} pooled\nUpdate: ${ms(field.quality.updateMs)}\nDraw submission: ${ms(field.quality.drawMs)}\nMain work EMA: ${ms(field.quality.workEMA)}\nDPR: ${field.dpr.toFixed(2)} / quality: ${field.mobile ? field.quality.level : 'desktop'}\nTRACE samples: ${field.trace.samples}\nInference: ${ms(metrics.inferenceMs)} / ${camera.inferenceMode}\nCamera: ${metrics.cameraFPS.toFixed(1)} fps / inference: ${metrics.inferenceFPS.toFixed(1)} fps\n*CPU/Canvas submission; excludes display/compositor cost`
        : `Delivered camera: ${metrics.cameraFPS.toFixed(1)} fps\nInference: ${metrics.inferenceFPS.toFixed(1)} fps / ${ms(metrics.inferenceMs)}\nMode: ${camera.inferenceMode}\nConfirmation: ${ms(metrics.confirmationMs)}\nAnimation start*: ${ms(metrics.animationStartMs)}\nDispatch → draw*: ${ms(metrics.renderQueueMs)}\nState: ${metrics.stage}${field.paused ? ' / paused' : ''}\n*Canvas proxy; not physical capture-to-display latency`;
      text.textContent += inferenceDetails + fidelity;
    }, 250);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  }
  cameraButton.addEventListener('click', () => { if (flow.screen !== 'CREATE') return; if (camera.requested) camera.stop(); else camera.start(); });
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

}

const flow = new OriginFlow({
  render(screen) {
    const origin = screen === 'ORIGIN';
    $('#origin-screen').hidden = !origin;
    $('#create-screen').hidden = screen !== 'CREATE';
    canvas.hidden = screen !== 'CREATE';
    $('#fusion-screen').hidden = screen !== 'IMPORT';
    $('#translate-screen').hidden = screen !== 'TRANSLATE';
    document.body.dataset.screen = screen;
    document.title = `UNFORM 4.0 — ${origin ? 'ORIGIN' : screen === 'CREATE' ? 'CREATE / GEOMETRY' : `FUSION / ${screen}`}`;
  },
  enter(first, path = 'GEOMETRY', material = null) {
    if (first) {
      initializeCreate();
      if (field) field.inputStartedAt = performance.now();
      else return;
    }
    field?.switchArtwork(path, material);
    if (!first) {
      field?.setWorkspaceActive(true);
      camera?.resetGestureInput();
      if (field && (field.width !== innerWidth || field.height !== innerHeight)) field.resize();
      status.textContent = field?.mode === 'VIEW' ? 'VIEW / Drag to look around. Your form is held.'
        : 'SCULPT / Your form is kept. Begin a new touch or enable the camera to continue.';
    }
    if (field) {
      field.syncArtworkControls?.();
      document.body.dataset.mode = field.mode;
      document.body.dataset.artwork = path;
      document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', button.dataset.mode === field.mode));
      document.querySelectorAll('.form-button').forEach(button => { button.classList.toggle('active', button.dataset.form === field.form); button.setAttribute('aria-pressed', button.dataset.form === field.form); });
      document.querySelectorAll('.form-button, #dispersion, #reset').forEach(control => { control.disabled = field.mode === 'VIEW'; });
      $('#undo').disabled = field.mode !== 'SCULPT' || !field.memory.commits.length;
      $('#dispersion').value = Math.round(field.dispersion * 100); $('#dispersion-value').value = `${Math.round(field.dispersion * 100)}%`;
      $('#form-caption').textContent = field.form === 'octahedron' ? '06 VERTICES / 12 EDGES / 08 FACES' : field.form.toUpperCase();
      $('#pause').setAttribute('aria-label', field.paused ? 'Play animation' : 'Pause animation');
      $('#pause').setAttribute('aria-pressed', field.paused);
      $('.masthead-caption').innerHTML = `SCULPTURES IN MOTION<br />CREATE / ${path}`;
      $('.eyebrow').textContent = `CREATE / ${path} — ${path === 'FUSION' ? 'IMAGE MATERIAL / 002' : 'OCTAHEDRON / 001'}`;
      document.title = `UNFORM 4.0 — CREATE / ${path}`;
      status.textContent = field.mode === 'VIEW' ? 'VIEW / Drag to observe; switch to SCULPT to shape.' : 'SCULPT / Begin a new touch. Slow drag to imprint; swipe to scatter.';
      $('#fusion-resume').hidden = path !== 'FUSION' && !field.artworks.has('FUSION');
      $('#geometry-action').textContent = 'RESUME CREATE →';
      $('#origin-draft').hidden = false;
      $('#origin-draft').textContent = path === 'FUSION' || field.artworks.has('FUSION') ? 'GEOMETRY and FUSION keep separate forms in this tab. Choose either to resume.' : 'Your current form is kept in this tab. Resume with GEOMETRY.';
      document.querySelector('button[data-mode][aria-pressed="true"]').focus({ preventScroll: true });
    }
  },
  leave() {
    releaseCaptures();
    field?.setWorkspaceActive(false);
    camera?.stop();
    $('#guide').hidden = true;
    $('#guide-toggle').setAttribute('aria-expanded', 'false');
    // Focus after the ORIGIN screen becomes visible.
    queueMicrotask(() => $('#geometry-start').focus({ preventScroll: true }));
  },
  hasChanges: () => field?.hasUnsavedShape() ?? false,
  confirmReturn: () => window.confirm('Return to ORIGIN? Your form has unsaved changes. It will stay in this tab, but refreshing or closing the page will lose it.'),
});
$('#geometry-start').addEventListener('click', () => flow.choose('GEOMETRY'));
document.querySelectorAll('[data-origin-back]').forEach(button => button.addEventListener('click', () => flow.back()));

mountFusion({ flow, root: document, particleCount: () => field?.poolCount ?? ParticleField.capacity(), beforeCreate: material => {
  const previous = field?.artworkName === 'FUSION' ? field : field?.artworks.get('FUSION');
  return !previous || previous.material === material || window.confirm('Replace the previous FUSION sculpture and its imprints? Your GEOMETRY form is kept.');
} });
$('#fusion-resume').addEventListener('click', () => flow.resumeFusion());
$('#fusion-start').addEventListener('click', () => {
  if (flow.choose('FUSION')) $('#fusion-title').focus({ preventScroll: true });
});
