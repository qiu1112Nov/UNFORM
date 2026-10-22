export class HandWorkerClient {
  static supported() {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
  }
  constructor(worker = null, { initTimeoutMs = 20000, frameTimeoutMs = 2000 } = {}) {
    this.initTimeoutMs = initTimeoutMs; this.frameTimeoutMs = frameTimeoutMs;
    this.worker = worker ?? new Worker(new URL(`${import.meta.env.BASE_URL}hand-worker.js`, location.href));
    this.pending = new Map(); this.serial = 0; this.closed = false;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id); clearTimeout(request.timer);
      if (data.ok) request.resolve(data); else request.reject(new Error(data.error));
    };
    this.worker.onerror = event => this.close(new Error(event?.message || 'Worker execution failed'));
  }
  request(type, payload, transfers = []) {
    if (this.closed) return Promise.reject(new Error('Worker is closed'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`${type} Worker request timed out`)); this.close();
      }, type === 'init' ? this.initTimeoutMs : this.frameTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, type, ...payload }, transfers); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  init(modelURL) {
    return this.request('init', {
      modelURL,
      visionURL: new URL(`${import.meta.env.BASE_URL}mediapipe/vision_bundle.mjs`, location.href).href,
      wasmURL: new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, location.href).href,
    });
  }
  async detect(video, timestamp) {
    if (this.closed) throw new Error('Worker is closed');
    const started = performance.now();
    let timer;
    const acquiring = createImageBitmap(video).then(bitmap => {
      if (this.closed) { bitmap.close(); throw new Error('Worker is closed'); }
      return bitmap;
    });
    let bitmap;
    try {
      bitmap = await Promise.race([acquiring, new Promise((_, reject) => {
        timer = setTimeout(() => { this.close(); reject(new Error('Frame capture timed out')); }, this.frameTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
    const bitmapMs = performance.now() - started;
    if (this.closed) { bitmap.close(); throw new Error('Worker is closed'); }
    try { const result = await this.request('frame', { bitmap, timestamp }, [bitmap]); return { ...result, bitmapMs }; }
    catch (error) { bitmap.close(); throw error; }
  }
  close(reason = new Error('Worker stopped')) {
    if (this.closed) return;
    this.closed = true; this.worker.terminate();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(reason); }
    this.pending.clear();
  }
}
