// Local RGBA asset preparation. No model calls, no character-specific pixel coordinates.
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { decode, resize } = require('./psd.cjs');
const { prepareComplete, weldOutfit } = require('./occlusion.cjs');
function prepare(input, output) {
  const root = path.dirname(input),
    source = JSON.parse(fs.readFileSync(input)),
    outRoot = path.dirname(output);
  fs.mkdirSync(outRoot, { recursive: true });
  const parts = source.layers.map((l) => {
    const [left, top, right, bottom] = l.bounding_box.absolute;
    return {
      ...l,
      left,
      top,
      png: resize(decode(path.join(root, l.file)), right - left, bottom - top),
    };
  });
  const find = (name) => {
    const p = parts.find((l) => l.name === name);
    if (!p) throw Error(`Required source part missing: ${name}`);
    return p;
  };
  const complete = source.preparation === 'occlusion-v2' ? prepareComplete(parts) : undefined;
  if (complete)
    fs.writeFileSync(
      path.join(outRoot, 'occlusion-report.json'),
      JSON.stringify(complete.report, null, 2),
    );
  const head = find('head'),
    hair = find(complete ? 'front_hair' : 'hair'),
    eyes = find('eyes');
  const center = head.left + head.png.width / 2,
    faceWidth = head.png.width;
  const layers = [];
  const emit = (name, p, left, top, mask) => {
    let minX = p.width,
      minY = p.height,
      maxX = -1,
      maxY = -1;
    const d = new Uint8ClampedArray(p.data);
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const i = (y * p.width + x) * 4;
        if (mask && !mask(x + left, y + top, d, i)) d[i + 3] = 0;
        if (d[i + 3] > 8) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    if (maxX < minX) return;
    const w = maxX - minX + 1,
      h = maxY - minY + 1,
      png = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const si = ((y + minY) * p.width + x + minX) * 4,
          di = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) png.data[di + c] = d[si + c];
      }
    const file = `part-${layers.length}.png`;
    fs.writeFileSync(path.join(outRoot, file), PNG.sync.write(png));
    layers.push({
      name,
      file,
      size: `${w}x${h}`,
      z_index: layers.length + 1,
      bounding_box: { absolute: [left + minX, top + minY, left + minX + w, top + minY + h] },
    });
  };
  const hairRoot = head.top * 0.8,
    leftEdge = head.left - faceWidth * 0.08,
    rightEdge = head.left + faceWidth * 1.08;
  // Adjacent parts need shared source pixels: a zero-overlap partition exposes
  // straight transparent cuts as soon as their independent deformers move.
  const join = faceWidth * 0.14;
  const ramp = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const coverage = (weight) => (x, y, d, i) => {
    d[i + 3] = Math.round(d[i + 3] * weight(x, y));
    return d[i + 3] > 0;
  };
  const roots = (y) => ramp(hairRoot - join, hairRoot, y);
  const leftMask = coverage(
      (x, y) => roots(y) * (1 - ramp(leftEdge + join, leftEdge + 3 * join, x)),
    ),
    rightMask = coverage((x, y) => roots(y) * ramp(rightEdge - 3 * join, rightEdge - join, x));
  const crownMask = coverage((x, y) =>
    Math.max(
      1 - ramp(hairRoot + join, hairRoot + 3 * join, y),
      ramp(leftEdge - join, leftEdge + join, x) * (1 - ramp(rightEdge - join, rightEdge + join, x)),
    ),
  );
  // The coarse six-part input has no isolated ornament or hidden scalp. Keep
  // the bucket attached to the continuous crown, never as a rectangular cutout.
  if (!complete) {
    emit('back hair right', hair.png, hair.left, hair.top, leftMask);
    emit('back hair left', hair.png, hair.left, hair.top, rightMask);
    const body = find('body');
    const arm = find('arm');
    emit('topwear', body.png, body.left, body.top, (x, y, d, i) => {
      const ax = x - arm.left,
        ay = y - arm.top;
      if (
        ax >= 0 &&
        ay >= 0 &&
        ax < arm.png.width &&
        ay < arm.png.height &&
        arm.png.data[(ay * arm.png.width + ax) * 4 + 3] > 24
      )
        d[i + 3] = 0;
      return true;
    });
    emit('handwear right', arm.png, arm.left, arm.top, (x) => x < center);
    emit('handwear left', arm.png, arm.left, arm.top, (x) => x >= center);
    emit('face', head.png, head.left, head.top);
  } else {
    const outfit = weldOutfit(complete.parts.get('body'), [
      complete.parts.get('arm_left'),
      complete.parts.get('arm_right'),
    ]);
    for (const [sourceName, target] of [
      ['back_hair_left', 'back hair left'],
      ['back_hair_right', 'back hair right'],
      ['neck', 'neck'],
      ['head', 'face'],
    ]) {
      const p = complete.parts.get(sourceName);
      emit(target, p.png, p.left, p.top);
      if (sourceName === 'neck') emit('topwear', outfit.png, outfit.left, outfit.top);
    }
  }
  for (const [side, x0, x1] of [
    ['right', 0, Math.floor(eyes.png.width / 2)],
    ['left', Math.floor(eyes.png.width / 2), eyes.png.width],
  ]) {
    const p = eyes.png,
      h = p.height;
    let minX = x1,
      minY = h,
      maxX = x0,
      maxY = 0;
    const hue = (r, g, b) => {
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        delta = max - min;
      if (delta < 1) return -1;
      let v = max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
      return (v + 6) % 6;
    };
    const histogram = new Array(36).fill(0);
    for (let y = Math.floor(h * 0.2); y < h; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * p.width + x) * 4,
          r = p.data[i],
          g = p.data[i + 1],
          b = p.data[i + 2],
          max = Math.max(r, g, b),
          sat = (max - Math.min(r, g, b)) / (max || 1),
          value = hue(r, g, b);
        if (p.data[i + 3] > 128 && max > 75 && sat > 0.18 && value >= 0)
          histogram[Math.min(35, Math.floor(value * 6))] += sat;
      }
    const dominant = histogram.indexOf(Math.max(...histogram)) / 6 + 0.083;
    let color = [0, 0, 0],
      samples = 0;
    for (let y = Math.floor(h * 0.18); y < h; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * p.width + x) * 4,
          r = p.data[i],
          g = p.data[i + 1],
          b = p.data[i + 2];
        const value = hue(r, g, b),
          distance = Math.min(Math.abs(value - dominant), 6 - Math.abs(value - dominant));
        if (p.data[i + 3] > 128 && value >= 0 && distance < 0.72 && Math.max(r, g, b) > 75) {
          color[0] += r;
          color[1] += g;
          color[2] += b;
          samples++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    if (maxX <= minX) throw Error(`Cannot locate ${side} iris in source; inspect eye artwork`);
    color = color.map((v) => Math.round(v / Math.max(1, samples)));
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      rx = (maxX - minX) / 2,
      ry = (maxY - minY) / 2;
    const white = {
      width: p.width,
      height: p.height,
      data: new Uint8ClampedArray(p.width * p.height * 4),
    };
    const iris = {
      width: p.width,
      height: p.height,
      data: new Uint8ClampedArray(p.width * p.height * 4),
    };
    for (let y = 0; y < h; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * p.width + x) * 4,
          ellipse = ((x - cx) / (rx * 1.22)) ** 2 + ((y - cy) / (ry * 1.04)) ** 2;
        if (ellipse <= 1) {
          white.data.set([255, 249, 252, 255], i);
        }
        const irisArea = ((x - cx) / (rx * 1.02)) ** 2 + ((y - cy) / (ry * 1.1)) ** 2;
        if (irisArea <= 1) {
          if (p.data[i + 3] > 100) for (let c = 0; c < 4; c++) iris.data[i + c] = p.data[i + c];
          else iris.data.set([...color, 255], i);
        }
      }
    emit(`eyewhite ${side}`, white, eyes.left, eyes.top);
    emit(`irides ${side}`, iris, eyes.left, eyes.top);
    emit(`eyelash ${side}`, p, eyes.left, eyes.top, (x, y, d, i) => {
      const lx = x - eyes.left,
        ly = y - eyes.top;
      if (lx < x0 || lx >= x1) return false;
      return (
        Math.max(d[i], d[i + 1], d[i + 2]) < 150 &&
        (ly < minY + ry * 0.3 || Math.abs(lx - cx) > rx * 0.95)
      );
    });
  }
  const mouth = find('mouth');
  emit('mouth open', mouth.png, mouth.left, mouth.top);
  emit('front hair', hair.png, hair.left, hair.top, complete ? undefined : crownMask);

  const manifest = { size: source.size, layers };
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ prepared: layers.length, layers: layers.map((l) => l.name) }));
  return manifest;
}
module.exports = { prepare };
if (require.main === module) prepare(process.argv[2], process.argv[3]);
