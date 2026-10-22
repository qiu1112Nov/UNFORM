import { credibleHand, GestureMetrics, GestureResponse, VideoFramePump } from './gesture-pipeline.js';
import { HandWorkerClient } from './hand-worker-client.js';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandCamera {
  constructor(video, onState, onHand) {
    this.video = video; this.onState = onState; this.onHand = onHand;
    this.session = 0; this.active = false; this.requested = false;
    this.stream = null; this.landmarker = null; this.pump = null;
    this.response = new GestureResponse(); this.metrics = new GestureMetrics();
    this.workerClient = null; this.inferenceMode = 'idle';
  }

  async start() {
    if (this.requested) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.onState('error', 'Camera needs HTTPS and a supported browser. Mouse and touch remain available.');
      return;
    }
    const session = ++this.session;
    this.requested = true;
    this.onState('loading', 'Allow camera access, then wait for the hand model to load.');
    let detector;
    const stale = () => session !== this.session;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
      if (stale()) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!stale()) this.stop('Camera disconnected. Mouse and touch remain available.'); });
      this.video.srcObject = stream;
      await this.video.play();
      if (stale()) return;
      if (HandWorkerClient.supported()) {
        let client;
        try {
          client = new HandWorkerClient(); this.workerClient = client;
          await client.init(MODEL);
          if (stale()) { client.close(); return; }
          this.inferenceMode = 'worker';
        } catch {
          client?.close();
          if (stale()) return;
          this.workerClient = null;
        }
      }
      if (!this.workerClient) {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        if (stale()) return;
        const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
        if (stale()) return;
        detector = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
          runningMode: 'VIDEO', numHands: 1,
          minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.5,
        });
        if (stale()) { detector.close(); return; }
        this.landmarker = detector; this.inferenceMode = 'main-thread fallback';
      }
      this.active = true;
      this.response.reset(); this.metrics.reset();
      this.onState('active', 'Camera ready. Open your palm to disperse; close your hand to gather.');
      const deliver = (result, inferenceMs, now) => {
        if (stale() || !this.active) return;
        const finished = performance.now();
        const hand = result.landmarks.length ? credibleHand(result.landmarks[0]) : null;
        const response = this.response.update(hand, finished);
        if (response?.response && response.response.frameAt === undefined) response.response.frameAt = now;
        if (response) response.dispatchedAt = performance.now();
        this.metrics.inference(finished, inferenceMs, response, this.response);
        this.onHand(response);
      };
      this.pump = new VideoFramePump(this.video, now => {
        if (stale() || !this.active) return 0;
        if (this.workerClient) {
          return this.workerClient.detect(this.video, now).then(result => {
            deliver(result, result.inferenceMs, now); return result.inferenceMs;
          }).catch(() => {
            if (!stale()) this.stop('Hand tracking stopped. Mouse and touch remain available.');
            return 0;
          });
        }
        try {
          const started = performance.now();
          const result = this.landmarker.detectForVideo(this.video, now);
          const finished = performance.now();
          deliver(result, finished - started, now);
          return finished - started;
        } catch { this.stop('Hand tracking stopped. Mouse and touch remain available.'); return 0; }
      }, now => this.metrics.frame(now));
      this.pump.start();
    } catch (error) {
      if (stale()) return;
      const denied = error.name === 'NotAllowedError' || error.name === 'SecurityError';
      this.stop(denied ? 'Camera permission was not granted. Mouse and touch remain available.' : 'Camera or hand model unavailable. Check your connection; mouse and touch remain available.');
    }
  }

  stop(message = 'Camera off. Mouse and touch are ready.') {
    this.session++; this.requested = false; this.active = false;
    this.pump?.stop(); this.pump = null;
    this.workerClient?.close(); this.workerClient = null; this.inferenceMode = 'idle';
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null;
    this.landmarker?.close(); this.landmarker = null;
    this.response.reset(); this.metrics.reset();
    this.onHand(null); this.onState('idle', message);
  }
}
