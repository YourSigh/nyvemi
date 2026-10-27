const { normalizeName } = require('./material.cjs');
// Expand pixels only underneath named opaque covers, never into the visible silhouette.
// This supplements reconstructed hidden artwork; it cannot invent a hidden forehead.
function alphaAt(part, x, y) {
  const px = x - part.left,
    py = y - part.top;
  return px >= 0 && py >= 0 && px < part.png.width && py < part.png.height
    ? part.png.data[(py * part.png.width + px) * 4 + 3]
    : 0;
}
function underlap(part, covers, radius) {
  const w = part.png.width + radius * 2,
    h = part.png.height + radius * 2;
  const data = new Uint8ClampedArray(w * h * 4),
    nearest = new Int32Array(w * h).fill(-1);
  const distance = new Uint16Array(w * h),
    queue = new Int32Array(w * h);
  let tail = 0,
    cursor = 0;
  for (let y = 0; y < part.png.height; y++)
    for (let x = 0; x < part.png.width; x++) {
      const from = (y * part.png.width + x) * 4,
        at = (y + radius) * w + x + radius;
      data.set(part.png.data.subarray(from, from + 4), at * 4);
      if (part.png.data[from + 3] > 200) {
        nearest[at] = at;
        queue[tail++] = at;
      }
    }
  while (cursor < tail) {
    const at = queue[cursor++],
      x = at % w;
    if (distance[at] >= radius) continue;
    for (const n of [x > 0 ? at - 1 : -1, x + 1 < w ? at + 1 : -1, at - w, at + w]) {
      if (n < 0 || n >= nearest.length || nearest[n] >= 0) continue;
      nearest[n] = nearest[at];
      distance[n] = distance[at] + 1;
      queue[tail++] = n;
    }
  }
  let added = 0;
  for (let at = 0; at < nearest.length; at++) {
    if (nearest[at] < 0 || distance[at] === 0) continue;
    const x = part.left - radius + (at % w),
      y = part.top - radius + Math.floor(at / w);
    if (!covers.some((cover) => alphaAt(cover, x, y) > 240)) continue;
    if (data[at * 4 + 3] >= 240) continue;
    const from = nearest[at] * 4;
    for (let c = 0; c < 4; c++) data[at * 4 + c] = data[from + c];
    added++;
  }
  return {
    ...part,
    left: part.left - radius,
    top: part.top - radius,
    png: { width: w, height: h, data },
    added,
  };
}
function overlap(a, b) {
  const x0 = Math.max(a.left, b.left),
    y0 = Math.max(a.top, b.top);
  const x1 = Math.min(a.left + a.png.width, b.left + b.png.width);
  const y1 = Math.min(a.top + a.png.height, b.top + b.png.height);
  let pixels = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (alphaAt(a, x, y) > 220 && alphaAt(b, x, y) > 220) pixels++;
  return pixels;
}
// Fill a conservative scalp cap only where opaque crown artwork covers it.
// Existing visible facial pixels are preserved exactly; this is an underpaint,
// not a replacement for the model-generated forehead/face/neck artwork.
function scalpUnderpaint(head, crown) {
  const lift = Math.round(head.png.width * 0.42),
    w = head.png.width,
    h = head.png.height + lift;
  const data = new Uint8ClampedArray(w * h * 4),
    color = [0, 0, 0];
  let samples = 0;
  for (let y = 0; y < Math.max(1, Math.floor(head.png.height * 0.2)); y++)
    for (let x = Math.floor(w * 0.3); x < w * 0.7; x++) {
      const at = (y * w + x) * 4;
      if (head.png.data[at + 3] < 240) continue;
      for (let c = 0; c < 3; c++) color[c] += head.png.data[at + c];
      samples++;
    }
  if (!samples) throw Error('No opaque forehead color for hidden scalp');
  color.forEach((v, i) => (color[i] = Math.round(v / samples)));
  let added = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const globalY = head.top - lift + y;
      const ellipse =
        ((x - w / 2) / (w * 0.48)) ** 2 +
        ((globalY - head.top - head.png.height * 0.2) / (w * 0.67)) ** 2;
      if (
        ellipse > 1 ||
        globalY > head.top + head.png.height * 0.4 ||
        alphaAt(crown, head.left + x, globalY) < 240
      )
        continue;
      data.set([...color, 255], (y * w + x) * 4);
      added++;
    }
  for (let y = 0; y < head.png.height; y++)
    for (let x = 0; x < w; x++) {
      const from = (y * w + x) * 4,
        to = ((y + lift) * w + x) * 4;
      const a = head.png.data[from + 3] / 255,
        base = data[to + 3] / 255,
        combined = a + base * (1 - a);
      for (let c = 0; c < 3; c++)
        data[to + c] = combined
          ? (head.png.data[from + c] * a + data[to + c] * base * (1 - a)) / combined
          : 0;
      data[to + 3] = combined * 255;
    }
  return { ...head, top: head.top - lift, png: { width: w, height: h, data }, scalpPixels: added };
}
// A continuous garment mesh is sufficient for the small-motion production
// profile. Weld the rest-pose sleeve artwork instead of exposing moving seams.
function weldOutfit(body, arms) {
  const parts = [...arms, body],
    left = Math.min(...parts.map((p) => p.left)),
    top = Math.min(...parts.map((p) => p.top));
  const w = Math.max(...parts.map((p) => p.left + p.png.width)) - left;
  const h = Math.max(...parts.map((p) => p.top + p.png.height)) - top;
  const data = new Uint8ClampedArray(w * h * 4);
  for (const p of parts)
    for (let y = 0; y < p.png.height; y++)
      for (let x = 0; x < p.png.width; x++) {
        const from = (y * p.png.width + x) * 4,
          to = ((y + p.top - top) * w + x + p.left - left) * 4;
        const a = p.png.data[from + 3] / 255,
          base = data[to + 3] / 255,
          combined = a + base * (1 - a);
        for (let c = 0; c < 3; c++)
          data[to + c] = combined
            ? (p.png.data[from + c] * a + data[to + c] * base * (1 - a)) / combined
            : 0;
        data[to + 3] = combined * 255;
      }
  return { ...body, left, top, png: { width: w, height: h, data } };
}
// Repair only the short root zone toward the crown. Unlike blind dilation,
// this paints the missing bridge between two contours and leaves the tail's
// visible silhouette alone. Color comes from inside the same hair mass.
function bridgeRoot(part, crown, side, headWidth) {
  const reach = Math.round(headWidth * 0.16),
    inset = Math.max(2, Math.round(headWidth * 0.018));
  const left = part.left - (side === 'right' ? reach : 0),
    top = part.top;
  const w = part.png.width + reach,
    h = part.png.height,
    data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    data.set(
      part.png.data.subarray(y * part.png.width * 4, (y + 1) * part.png.width * 4),
      (y * w + part.left - left) * 4,
    );
  const rootColor = [0, 0, 0],
    interior = [];
  for (let y = 0; y < Math.ceil(h * 0.25); y++)
    for (let x = 0; x < part.png.width; x++) {
      const at = (y * part.png.width + x) * 4;
      if (part.png.data[at + 3] > 240) interior.push(at);
    }
  const luminance = (at) => (part.png.data[at] + part.png.data[at + 1] + part.png.data[at + 2]) / 3;
  const ordered = interior.map(luminance).sort((a, b) => a - b);
  const threshold = ordered[Math.floor(ordered.length * 0.6)] ?? 0;
  let rootSamples = 0;
  for (const at of interior) {
    if (luminance(at) < threshold) continue;
    for (let c = 0; c < 3; c++) rootColor[c] += part.png.data[at + c];
    rootSamples++;
  }
  rootColor.forEach((v, i) => (rootColor[i] = Math.round(v / Math.max(1, rootSamples))));
  let added = 0;
  for (let y = 0; y < Math.ceil(h * 0.3); y++) {
    const globalY = top + y;
    let edge = side === 'left' ? -1 : part.png.width;
    for (let x = 0; x < part.png.width; x++)
      if (part.png.data[(y * part.png.width + x) * 4 + 3] > 220)
        edge = side === 'left' ? Math.max(edge, x) : Math.min(edge, x);
    if (edge < 0 || edge >= part.png.width) continue;
    const start = part.left + edge,
      step = side === 'left' ? 1 : -1;
    let target;
    for (let d = 0; d <= reach - inset; d++)
      if (alphaAt(crown, start + step * d, globalY) > 240) {
        target = start + step * (d + inset);
        break;
      }
    if (target === undefined) continue;
    const sampleX = Math.max(0, Math.min(part.png.width - 1, edge - step * inset));
    const sample = (y * part.png.width + sampleX) * 4;
    if (part.png.data[sample + 3] < 200) continue;
    for (let x = start; side === 'left' ? x <= target : x >= target; x += step) {
      const px = x - left;
      if (px < 0 || px >= w) continue;
      const at = (y * w + px) * 4;
      if (data[at + 3] > 220) continue;
      data.set(rootSamples ? [...rootColor, 255] : part.png.data.subarray(sample, sample + 4), at);
      added++;
    }
  }
  return { ...part, left, png: { width: w, height: h, data }, rootPixels: added };
}
function prepareComplete(parts) {
  const available = new Map();
  for (const p of parts) {
    const name = normalizeName(p.name);
    if (available.has(name)) throw Error(`Duplicate material part: ${name}`);
    available.set(name, p);
  }
  for (const name of ['body', 'neck', 'head', 'eyes', 'mouth'])
    if (!available.has(name)) throw Error(`Hidden-area input missing: ${name}`);
  if (
    available.has('back_hair') &&
    (available.has('back_hair_left') || available.has('back_hair_right'))
  )
    throw Error('Ambiguous rear hair: use a single mass or separated masses, not both');
  const names = [
    'back_hair',
    'back_hair_left',
    'back_hair_right',
    'body',
    'neck',
    'arm_left',
    'arm_right',
    'head',
    'eyes',
    'mouth',
    'front_hair',
  ].filter((name) => available.has(name));
  const input = new Map(names.map((name) => [name, available.get(name)]));
  const radius = Math.max(3, Math.round(input.get('head').png.width * 0.05));
  const crown = input.get('front_hair');
  const scalp = crown ? scalpUnderpaint(input.get('head'), crown) : input.get('head');
  input.set('head', scalp);
  if (crown)
    for (const name of ['back_hair_left', 'back_hair_right']) {
      const part = input.get(name);
      if (!part) continue;
      const side =
        part.left + part.png.width / 2 < scalp.left + scalp.png.width / 2 ? 'left' : 'right';
      input.set(name, bridgeRoot(part, crown, side, scalp.png.width));
    }
  const covers = {
    back_hair: ['head', 'front_hair', 'neck', 'body'],
    back_hair_left: ['head', 'front_hair'],
    back_hair_right: ['head', 'front_hair'],
    body: ['arm_left', 'arm_right', 'neck'],
    neck: ['head', 'body'],
    arm_left: ['body'],
    arm_right: ['body'],
    head: ['front_hair'],
    front_hair: [],
    eyes: [],
    mouth: [],
  };
  const output = new Map(
    names.map((name) => [
      name,
      covers[name].length
        ? underlap(
            input.get(name),
            covers[name].filter((n) => input.has(n)).map((n) => input.get(n)),
            radius,
          )
        : input.get(name),
    ]),
  );
  const links = [
    ['head', 'neck'],
    ['neck', 'body'],
  ];
  for (const name of ['back_hair', 'back_hair_left', 'back_hair_right']) {
    if (!input.has(name)) continue;
    const candidates = ['front_hair', 'head'].filter((n) => input.has(n));
    candidates.sort(
      (a, b) => overlap(output.get(name), output.get(b)) - overlap(output.get(name), output.get(a)),
    );
    links.push([name, candidates[0]]);
  }
  for (const name of ['arm_left', 'arm_right']) if (input.has(name)) links.push([name, 'body']);
  const joints = links.map(([a, b]) => ({
    a,
    b,
    before: overlap(input.get(a), input.get(b)),
    pixels: overlap(output.get(a), output.get(b)),
  }));
  const minimum = Math.max(4, Math.round(input.get('head').png.width ** 2 * 0.0002));
  const broken = joints.filter((j) => j.pixels < minimum);
  if (broken.length)
    throw Error(
      `Disconnected source joints: ${broken.map((j) => j.a + '/' + j.b).join(', ')}; inspect or repair hidden artwork before compiling`,
    );
  output.set('body', input.get('body'));
  if (input.has('arm_left')) output.set('arm_left', input.get('arm_left'));
  if (input.has('arm_right')) output.set('arm_right', input.get('arm_right'));
  return {
    parts: output,
    report: {
      profile: 'occlusion-v2',
      radius,
      minimum,
      joints,
      topology: {
        rearHair: names.filter((n) => n.startsWith('back_hair')),
        frontHair: !!crown,
        separateArms: names.filter((n) => n.startsWith('arm_')),
      },
      scalpPixels: scalp.scalpPixels || 0,
      rootPixels: Object.fromEntries(
        ['left', 'right']
          .filter((side) => input.has('back_hair_' + side))
          .map((side) => [side, input.get('back_hair_' + side).rootPixels || 0]),
      ),
      outfit: 'continuous-rest-pose',
      addedPixels: Object.fromEntries([...output].map(([n, p]) => [n, p.added || 0])),
    },
  };
}
module.exports = {
  alphaAt,
  underlap,
  overlap,
  prepareComplete,
  scalpUnderpaint,
  weldOutfit,
  bridgeRoot,
};
