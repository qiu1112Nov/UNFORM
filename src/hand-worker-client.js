export class HandWorkerClient {
  static supported() {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
  }
  constructor(worker = null) {
    this.worker = worker ?? new Worker(new URL(`${import.meta.env.BASE_URL}hand-worker.js`, location.href));
    this.pending = new Map(); this.serial = 0; this.closed = false;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.ok) request.resolve(data); else request.reject(new Error(data.error));
    };
    this.worker.onerror = () => this.close();
  }
  request(type, payload, transfers = []) {
    if (this.closed) return Promise.reject(new Error('Worker is closed'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, type, ...payload }, transfers); }
      catch (error) { this.pending.delete(id); reject(error); }
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
    const started = performance.now();
    const bitmap = await createImageBitmap(video);
    const bitmapMs = performance.now() - started;
    if (this.closed) { bitmap.close(); throw new Error('Worker is closed'); }
    try { const result = await this.request('frame', { bitmap, timestamp }, [bitmap]); return { ...result, bitmapMs }; }
    catch (error) { bitmap.close(); throw error; }
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new Error('Worker stopped'));
    this.pending.clear();
  }
}
