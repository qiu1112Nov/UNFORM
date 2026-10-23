export function densityImage(name, n = 128) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + .5) / n, v = (y + .5) / n, r = Math.hypot(u - .5, v - .5);
    let on = false, value = 0, alpha = 255;
    if (name === 'ring') on = r > .23 && r < .33;
    if (name === 'vertical') on = Math.abs(u - .5) < .065 && Math.abs(v - .5) < .37;
    if (name === 'horizontal') on = Math.abs(v - .5) < .065 && Math.abs(u - .5) < .37;
    if (name === 'clusters') on = Math.hypot(u - .24, v - .33) < .13 || Math.hypot(u - .76, v - .66) < .13;
    if (name === 'inverted') on = Math.hypot(u - .23, v - .33) < .12;
    if (name === 'corner') on = (u > .24 && u < .38 && v > .18 && v < .8) || (v > .66 && v < .8 && u > .24 && u < .8);
    if (name === 'transparent') { on = r < .28; alpha = on ? 255 : 0; }
    value = on ? 235 : 12;
    if (name === 'inverted') value = on ? 12 : 235;
    if (name === 'noise') value = ((Math.imul(x + y * n + 1, 374761393) ^ Math.imul(y + 99, 668265263)) >>> 16) % 256;
    if (name === 'texture') value = (x + y) % 2 ? 235 : 12;
    if (name === 'low') value = 120 + (u > .5 ? 2 : 0);
    if (name === 'empty') { value = 255; alpha = 0; }
    data.set([value, value, value, alpha], (y * n + x) * 4);
  }
  return { pixels: { width: n, height: n, data } };
}
