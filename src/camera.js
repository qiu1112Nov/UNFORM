import { credibleHand, GestureMetrics, GestureResponse, VideoFramePump } from './gesture-pipeline.js';
import { HandWorkerClient } from './hand-worker-client.js';
import { InferenceQuality } from './inference-quality.js';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function createMainDetector() {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1,
    minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.5,
  });
}

export class HandCamera {
  constructor(video, onState, onHand, { mobile = false, renderStats = () => null,
    workerSupported = () => HandWorkerClient.supported(), createWorker = () => new HandWorkerClient(),
    createDetector = createMainDetector, clock = () => performance.now() } = {}) {
    this.video = video; this.onState = onState; this.onHand = onHand;
    this.mobile = mobile; this.renderStats = renderStats; this.workerSupported = workerSupported;
    this.createWorker = createWorker; this.createDetector = createDetector; this.clock = clock;
    this.inputEpoch = 0; this.session = 0; this.active = false; this.requested = false;
    this.stream = null; this.landmarker = null; this.pump = null; this.workerClient = null;
    this.response = new GestureResponse(); this.metrics = new GestureMetrics();
    this.inputQuality = new InferenceQuality(mobile);
    this.input = null; this.inputContext = null; this.inferenceMode = 'idle';
    this.cameraStage = 'off'; this.modelStage = 'idle'; this.inferenceStage = 'idle';
    this.lastError = ''; this.lastInferenceAt = null; this.lastRecognitionAt = null; this.hasHand = false;
    this.trackingStartedAt = 0;
    this.captureMs = null; this.roundTripMs = null; this.sourceWidth = 0; this.sourceHeight = 0;
    this.facingMode = 'unknown'; this.mirrored = true;
  }

  async loadMain(session) {
    this.workerClient?.close(); this.workerClient = null;
    this.inferenceMode = 'switching to main-thread'; this.modelStage = 'loading fallback';
    const detector = await this.createDetector();
    if (session !== this.session) { detector.close(); return; }
    this.landmarker = detector; this.inferenceMode = 'main-thread fallback'; this.modelStage = 'ready';
    if (this.pump) { this.pump.costFactor = 1.5; this.pump.cost = 0; }
  }

  async start() {
    if (this.requested) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.lastError = 'Camera needs HTTPS and a supported browser.';
      this.cameraStage = 'error'; this.onState('error', `${this.lastError} Mouse and touch remain available.`); return;
    }
    const session = ++this.session, stale = () => session !== this.session;
    this.inputQuality = new InferenceQuality(this.mobile); this.requested = true;
    this.cameraStage = 'requesting'; this.modelStage = 'idle'; this.lastError = '';
    this.onState('loading', 'Allow camera access, then wait for the hand model to load.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: {
        facingMode: { ideal: 'user' }, width: { ideal: this.mobile ? 480 : 640 },
        height: { ideal: this.mobile ? 360 : 480 }, frameRate: { ideal: 30, max: 30 },
      }, audio: false });
      if (stale()) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', () => { if (!stale()) this.stop('Camera disconnected. Mouse and touch remain available.'); });
      this.facingMode = track?.getSettings?.().facingMode || 'unknown';
      this.mirrored = this.facingMode !== 'environment';
      this.video.style.transform = this.mirrored ? 'scaleX(-1)' : 'none';
      this.video.playsInline = true; this.video.muted = true; this.video.srcObject = stream;
      await this.video.play();
      if (stale()) return;
      this.cameraStage = 'streaming'; this.modelStage = 'loading';
      if (this.workerSupported()) {
        try {
          this.workerClient = this.createWorker(); await this.workerClient.init(MODEL);
          if (stale()) return;
          this.inferenceMode = 'worker'; this.modelStage = 'ready';
        } catch (error) {
          if (stale()) return;
          this.lastError = `Worker initialization: ${error.message}`;
          await this.loadMain(session);
        }
      } else await this.loadMain(session);
      if (stale()) return;
      this.input = document.createElement('canvas'); this.inputContext = this.input.getContext('2d', { alpha: false });
      if (!this.inputContext) throw new Error('Camera frame capture unavailable');
      this.active = true; this.trackingStartedAt = this.clock(); this.inferenceStage = 'waiting for video';
      this.response.reset(); this.metrics.reset();
      this.onState('active', 'Camera and model ready. Looking for a hand.');
      this.pump = new VideoFramePump(this.video, now => this.processFrame(now, session), now => this.metrics.frame(now), this.clock);
      this.pump.costFactor = this.workerClient ? 1 : 1.5; this.pump.start();
    } catch (error) {
      if (stale()) return;
      this.lastError = error.message; this.stop('Camera or hand model unavailable. Mouse and touch remain available.');
      this.modelStage = 'error';
    }
  }

  resetGestureInput() {
    // Keep the camera/model/pump running; reject control results captured before
    // this boundary, including an in-flight Worker frame.
    this.inputEpoch++; this.response.reset();
    this.metrics.responseId = null; this.metrics.confirmationMs = null;
    this.metrics.animationStartMs = null; this.metrics.renderQueueMs = null; this.metrics.stage = 'waiting';
  }

  // Both backends use this exact mapping/confirmation interface.
  receive(result, inferenceMs, now, captureMs, inputEpoch = this.inputEpoch) {
    const finished = this.clock();
    this.captureMs = captureMs; this.roundTripMs = finished - now; this.lastInferenceAt = finished;
    this.inputQuality.observe(finished, inferenceMs, this.roundTripMs, this.renderStats());
    const hand = result.landmarks.length ? credibleHand(result.landmarks[0]) : null;
    if (hand && !this.mirrored) hand.x = 1 - hand.x;
    this.hasHand = Boolean(hand); this.inferenceStage = hand ? 'hand detected' : 'running / no hand';
    if (hand) this.lastRecognitionAt = finished;
    if (inputEpoch !== this.inputEpoch) {
      this.metrics.inference(finished, inferenceMs, null, this.response); return;
    }
    const response = this.response.update(hand, finished, now);
    if (response?.response && response.response.frameAt === undefined) response.response.frameAt = now;
    if (response) response.dispatchedAt = finished;
    this.metrics.inference(finished, inferenceMs, response, this.response); this.onHand(response);
  }

  async processFrame(now, session) {
    if (session !== this.session || !this.active) return 0;
    const inputEpoch = this.inputEpoch;
    let worker = null;
    try {
      this.sourceWidth = this.video.videoWidth; this.sourceHeight = this.video.videoHeight;
      if (this.video.readyState < 2 || this.sourceWidth <= 0 || this.sourceHeight <= 0) return 0;
      const size = this.inputQuality.dimensions(this.sourceWidth, this.sourceHeight);
      if (this.input.width !== size.width || this.input.height !== size.height) { this.input.width = size.width; this.input.height = size.height; }
      // Decoded video has the browser's orientation. No crop, CSS mirror, or
      // viewport orientation is applied to inference pixels a second time.
      this.inputContext.drawImage(this.video, 0, 0, size.width, size.height);
      const preparedMs = this.clock() - now; this.inferenceStage = 'running';
      worker = this.workerClient;
      if (worker) {
        const result = await worker.detect(this.input, now);
        if (session === this.session && this.active) this.receive(result, result.inferenceMs, now, preparedMs + result.bitmapMs, inputEpoch);
      } else {
        const started = this.clock(), result = this.landmarker.detectForVideo(this.input, now);
        this.receive(result, this.clock() - started, now, preparedMs, inputEpoch);
      }
      return this.clock() - now;
    } catch (error) {
      if (session !== this.session) return 0;
      this.lastError = `${worker ? 'Worker inference' : 'Camera inference'}: ${error.message}`;
      if (worker) {
        // The pump remains busy until this switch settles. Never run two models
        // on overlapping frames; terminate the failed Worker before loading.
        try { await this.loadMain(session); }
        catch (fallbackError) {
          if (session === this.session) { this.lastError += `; fallback: ${fallbackError.message}`; this.stop('Hand tracking unavailable. Mouse and touch remain available.'); }
        }
      } else this.stop('Hand tracking unavailable. Mouse and touch remain available.');
      return 0;
    }
  }

  diagnostics(now = this.clock()) {
    return { camera: this.cameraStage, model: this.modelStage,
      inference: this.active && now - (this.lastInferenceAt ?? this.trackingStartedAt) > 2000
        ? (this.video.videoWidth > 0 ? 'stalled' : 'waiting for valid video dimensions') : this.inferenceStage,
      readyState: this.video.readyState, videoWidth: this.video.videoWidth, videoHeight: this.video.videoHeight,
      mediaTime: this.video.currentTime, facingMode: this.facingMode,
      hasHand: this.hasHand && now - (this.lastRecognitionAt ?? -Infinity) < 350,
      lastRecognitionAt: this.lastRecognitionAt, error: this.lastError };
  }

  stop(message = 'Camera off. Mouse and touch are ready.') {
    this.session++; this.requested = false; this.active = false;
    this.pump?.stop(); this.pump = null; this.workerClient?.close(); this.workerClient = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null; this.landmarker?.close(); this.landmarker = null;
    this.input = null; this.inputContext = null; this.inferenceMode = 'idle'; this.cameraStage = 'off'; this.modelStage = 'idle'; this.inferenceStage = 'idle';
    this.captureMs = null; this.roundTripMs = null; this.sourceWidth = 0; this.sourceHeight = 0;
    this.hasHand = false; this.lastInferenceAt = null; this.lastRecognitionAt = null;
    this.response.reset(); this.metrics.reset(); this.onHand(null); this.onState('idle', message);
  }
}
