// QA rendering of provider layers; never modifies the source or shipped model assets.
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { PNG } = require('pngjs');
const { decode, resize } = require('../vtuber/psd.cjs');
const diskPath = (uri) => (uri.startsWith('file:') ? fileURLToPath(uri) : uri);
function write(file, raster) {
  fs.writeFileSync(file, PNG.sync.write({ ...raster, data: Buffer.from(raster.data) }));
}
function over(destination, source, left, top) {
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const tx = x + left,
        ty = y + top;
      if (tx < 0 || ty < 0 || tx >= destination.width || ty >= destination.height) continue;
      const s = (y * source.width + x) * 4,
        d = (ty * destination.width + tx) * 4;
      const a = source.data[s + 3] / 255,
        b = destination.data[d + 3] / 255,
        combined = a + b * (1 - a);
      for (let c = 0; c < 3; c++)
        destination.data[d + c] = combined
          ? Math.round((source.data[s + c] * a + destination.data[d + c] * b * (1 - a)) / combined)
          : 0;
      destination.data[d + 3] = Math.round(combined * 255);
    }
}
function checked(raster) {
  const background = {
    width: raster.width,
    height: raster.height,
    data: new Uint8ClampedArray(raster.data.length),
  };
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++) {
      const i = (y * raster.width + x) * 4,
        value = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 225 : 246;
      background.data[i] = background.data[i + 1] = background.data[i + 2] = value;
      background.data[i + 3] = 255;
    }
  over(background, raster, 0, 0);
  return background;
}
function renderRig(rig, output) {
  fs.mkdirSync(output, { recursive: true });
  const width = 640,
    scale = width / rig.width,
    height = Math.round(rig.height * scale);
  const canvas = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const stats = [];
  for (const [i, layer] of [...rig.layers].sort((a, b) => a.z - b.z).entries()) {
    const raw = decode(diskPath(layer.asset.uri));
    let transparent = 0,
      visible = 0;
    for (let n = 3; n < raw.data.length; n += 4) {
      if (raw.data[n] < 8) transparent++;
      if (raw.data[n] > 8) visible++;
    }
    const [x, y, w, h] = layer.bounds;
    over(
      canvas,
      resize(raw, Math.max(1, Math.round(w * width)), Math.max(1, Math.round(h * height))),
      Math.round(x * width),
      Math.round(y * height),
    );
    const preview = path.join(output, `layer-${i}-${layer.role}.png`);
    const display = resize(
      raw,
      Math.min(512, raw.width),
      Math.max(1, Math.round((raw.height * Math.min(512, raw.width)) / raw.width)),
    );
    write(preview, checked(display));
    stats.push({
      role: layer.role,
      width: raw.width,
      height: raw.height,
      visible,
      transparent,
      bounds: layer.bounds,
      preview,
    });
  }
  const composite = path.join(output, 'composite.png'),
    transparentComposite = path.join(output, 'composite-transparent.png');
  write(transparentComposite, canvas);
  write(composite, checked(canvas));
  return { composite, transparentComposite, width, height, layers: stats };
}
module.exports = { renderRig };
if (require.main === module)
  console.log(
    JSON.stringify(
      renderRig(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.argv[3]),
      null,
      2,
    ),
  );
