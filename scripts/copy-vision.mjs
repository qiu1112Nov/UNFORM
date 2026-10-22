import { cpSync, mkdirSync } from 'node:fs';
const target = new URL('../public/mediapipe/wasm/', import.meta.url);
mkdirSync(target, { recursive: true });
cpSync(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), target, { recursive: true });
cpSync(new URL('../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', import.meta.url), new URL('../public/mediapipe/vision_bundle.mjs', import.meta.url));
console.log('MediaPipe WASM assets copied locally.');
