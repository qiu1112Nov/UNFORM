export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// A deterministic low-discrepancy distribution keeps transitions coherent.
export function formPoint(form, index, count) {
  const u = (index + 0.5) / count;
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  if (form === 'lines') {
    const row = index % 9;
    const x = ((Math.floor(index / 9) + 0.5) / Math.ceil(count / 9) - 0.5) * 2;
    return [x, (row - 4) * 0.17 + Math.sin(x * 2.8 + row * 0.38) * 0.2, Math.cos(angle) * 0.1];
  }
  if (form === 'grid') {
    const side = Math.ceil(Math.sqrt(count));
    return [(index % side) / (side - 1) * 1.7 - 0.85, Math.floor(index / side) / (side - 1) * 1.7 - 0.85, Math.sin(angle) * 0.06];
  }
  // Fibonacci sphere: every point is a particle on a rotating orbital shell.
  const y = 1 - 2 * u;
  const radius = Math.sqrt(1 - y * y);
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

export function handGesture(landmarks) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const wrist = landmarks[0];
  const palmSize = Math.max(distance(wrist, landmarks[9]), 0.01);
  // Ratios to palm size tolerate hand size and distance from the camera.
  const extension = [8, 12, 16, 20].reduce((total, tip) => total + distance(wrist, landmarks[tip]) / palmSize, 0) / 4;
  const openness = clamp((extension - 1.05) / 0.9);
  const center = [0, 5, 9, 13, 17].reduce((sum, i) => ({ x: sum.x + landmarks[i].x / 5, y: sum.y + landmarks[i].y / 5 }), { x: 0, y: 0 });
  return { x: 1 - center.x, y: center.y, openness };
}
