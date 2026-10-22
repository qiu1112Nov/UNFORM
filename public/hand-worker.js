// Classic worker: MediaPipe's WASM loader requires importScripts support.
// The version-pinned ESM bundle is copied locally by scripts/copy-vision.mjs.
let landmarker = null;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  let bitmap;
  try {
    if (type === 'init') {
      const { FilesetResolver, HandLandmarker } = await import(data.visionURL);
      const vision = await FilesetResolver.forVisionTasks(data.wasmURL);
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: data.modelURL, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.5,
      });
      self.postMessage({ id, ok: true });
    } else if (type === 'frame') {
      bitmap = data.bitmap;
      const started = performance.now();
      const result = landmarker.detectForVideo(bitmap, data.timestamp);
      self.postMessage({ id, ok: true, landmarks: result.landmarks, inferenceMs: performance.now() - started });
    }
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || 'Worker inference failed' });
  } finally { bitmap?.close(); }
};
