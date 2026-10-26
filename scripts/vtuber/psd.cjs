const fs = require('node:fs');
const path = require('node:path');
const ag = require('ag-psd');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
ag.initializeCanvas(
  () => {
    throw Error('Canvas is not required for RGBA PSD writing');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);
function decode(file) {
  const b = fs.readFileSync(file);
  return b[0] === 137 ? PNG.sync.read(b) : jpeg.decode(b, { useTArray: true });
}
function resize(p, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.max(0, Math.min(p.width - 1, ((x + 0.5) * p.width) / w - 0.5)),
        sy = Math.max(0, Math.min(p.height - 1, ((y + 0.5) * p.height) / h - 0.5));
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy),
        x1 = Math.min(p.width - 1, x0 + 1),
        y1 = Math.min(p.height - 1, y0 + 1),
        fx = sx - x0,
        fy = sy - y0;
      for (let c = 0; c < 4; c++)
        data[(y * w + x) * 4 + c] = Math.round(
          p.data[(y0 * p.width + x0) * 4 + c] * (1 - fx) * (1 - fy) +
            p.data[(y0 * p.width + x1) * 4 + c] * fx * (1 - fy) +
            p.data[(y1 * p.width + x0) * 4 + c] * (1 - fx) * fy +
            p.data[(y1 * p.width + x1) * 4 + c] * fx * fy,
        );
    }
  return { width: w, height: h, data };
}
function convert(input, output) {
  const root = path.dirname(input),
    manifest = JSON.parse(fs.readFileSync(input)),
    [width, height] = manifest.size.split('x').map(Number);
  const composite = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const children = manifest.layers
    .sort((a, b) => a.z_index - b.z_index)
    .map((l) => {
      const [x, y, r, b] = l.bounding_box.absolute;
      const w = Math.max(1, Math.round(r - x)),
        h = Math.max(1, Math.round(b - y));
      return {
        name: l.name,
        left: x,
        top: y,
        imageData: resize(decode(path.join(root, l.file)), w, h),
      };
    });
  // ag-psd uses bottom-to-top layer ordering, matching the Ark z-index convention.
  fs.writeFileSync(
    output,
    ag.writePsdBuffer(
      { width, height, children, imageData: composite },
      { generateThumbnail: false, noBackground: true, trimImageData: true },
    ),
  );
  const check = ag.readPsd(fs.readFileSync(output), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  if (check.children.length !== children.length) throw Error('PSD layer round-trip mismatch');
  console.log(
    JSON.stringify({ psd: output, width, height, layers: check.children.map((l) => l.name) }),
  );
}
module.exports = { decode, resize, convert };
if (require.main === module) convert(process.argv[2], process.argv[3]);
