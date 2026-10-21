import { handGesture } from './geometry.js';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandCamera {
  constructor(video, onState, onHand) {
    this.video = video; this.onState = onState; this.onHand = onHand;
    this.session = 0; this.active = false; this.requested = false;
    this.stream = null; this.landmarker = null; this.frame = 0;
    this.lastDetection = 0; this.lastVideoTime = -1;
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (stale()) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!stale()) this.stop('Camera disconnected. Mouse and touch remain available.'); });
      this.video.srcObject = stream;
      await this.video.play();
      if (stale()) return;
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
      this.landmarker = detector; this.active = true;
      this.lastVideoTime = -1; this.lastDetection = 0;
      this.onState('active', 'Camera ready. Open your palm to disperse; close your hand to gather.');
      const detect = now => {
        if (stale() || !this.active) return;
        // A single hand at 12 Hz keeps inference bounded on mobile devices.
        if (now - this.lastDetection >= 83 && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
          this.lastDetection = now; this.lastVideoTime = this.video.currentTime;
          try {
            const result = this.landmarker.detectForVideo(this.video, now);
            this.onHand(result.landmarks.length ? handGesture(result.landmarks[0]) : null);
          } catch { this.stop('Hand tracking stopped. Mouse and touch remain available.'); return; }
        }
        this.frame = requestAnimationFrame(detect);
      };
      this.frame = requestAnimationFrame(detect);
    } catch (error) {
      if (stale()) return;
      const denied = error.name === 'NotAllowedError' || error.name === 'SecurityError';
      this.stop(denied ? 'Camera permission was not granted. Mouse and touch remain available.' : 'Camera or hand model unavailable. Check your connection; mouse and touch remain available.');
    }
  }

  stop(message = 'Camera off. Mouse and touch are ready.') {
    this.session++; this.requested = false; this.active = false;
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null;
    this.landmarker?.close(); this.landmarker = null;
    this.onHand(null); this.onState('idle', message);
  }
}
