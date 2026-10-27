// Deterministic production-contract fixtures, not AI art or a visual-quality guarantee.
const fs = require('node:fs'),
  path = require('node:path'),
  { PNG } = require('pngjs');
const styles = [
  {
    id: 'short-black',
    hair: 'short',
    eye: [28, 28, 32],
    color: [27, 24, 31],
    skin: [225, 180, 145],
    arms: false,
  },
  {
    id: 'long-brown',
    hair: 'long',
    eye: [45, 170, 65],
    color: [90, 54, 30],
    skin: [245, 213, 193],
    arms: true,
  },
  {
    id: 'dark-skin-blue',
    hair: 'twin',
    eye: [45, 95, 210],
    color: [54, 32, 23],
    skin: [113, 71, 49],
    arms: true,
  },
  {
    id: 'bald-gray',
    hair: 'none',
    eye: [70, 70, 70],
    color: [0, 0, 0],
    skin: [185, 132, 91],
    arms: false,
  },
];
function writeFixture(root, style) {
  fs.mkdirSync(root, { recursive: true });
  const layers = [];
  const add = (name, box, color, mask = () => true) => {
    const [left, top, right, bottom] = box,
      png = new PNG({ width: right - left, height: bottom - top });
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        const value = mask(x, y, png.width, png.height);
        if (!value) continue;
        png.data.set([...(Array.isArray(value) ? value : color), 255], (y * png.width + x) * 4);
      }
    const file = `source-${layers.length}.png`;
    fs.writeFileSync(path.join(root, file), PNG.sync.write(png));
    layers.push({ name, file, z_index: layers.length + 1, bounding_box: { absolute: box } });
  };
  const ellipse = (x, y, w, h) =>
    ((x - w / 2) / (w / 2 - 1)) ** 2 + ((y - h / 2) / (h / 2 - 1)) ** 2 < 1;
  add('Torso', [83, 207, 174, 348], [65, 100, 110]);
  add('Neck', [116, 184, 141, 221], style.skin);
  add('Face', [70, 80, 186, 201], style.skin, ellipse);
  if (style.hair !== 'none')
    add(
      'Hair Front',
      [66, 47, 190, 153],
      style.color,
      (x, y, w, h) => (y < 70 || x < 18 || x > w - 18) && ellipse(x, y, w, h),
    );
  if (style.hair === 'long')
    add('Rear Hair', [64, 65, 192, 259], style.color, (x, y) => y < 52 || x < 30 || x > 100);
  if (style.hair === 'twin') {
    add(
      'Rear Hair Left',
      [32, 65, 89, 260],
      style.color,
      (x, y, w, h) => y < 32 || ellipse(x, y, w, h),
    );
    add(
      'Rear Hair Right',
      [167, 65, 224, 260],
      style.color,
      (x, y, w, h) => y < 32 || ellipse(x, y, w, h),
    );
  }
  if (style.arms) {
    add('Left Arm', [45, 215, 91, 267], [65, 100, 110]);
    add('Right Arm', [166, 215, 212, 267], [65, 100, 110]);
  }
  add('Eyes', [85, 121, 171, 152], style.eye, (x, y) => {
    const cx = x < 43 ? 21 : 64;
    if (((x - cx) / 7) ** 2 + ((y - 16) / 11) ** 2 < 1) return style.eye;
    if (((x - cx) / 14) ** 2 + ((y - 16) / 12) ** 2 < 1) return [247, 245, 240];
    return false;
  });
  add('Mouth', [123, 166, 133, 176], [80, 35, 40], ellipse);
  const file = path.join(root, 'layers.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ size: '256x384', preparation: 'occlusion-v2', layers }, null, 2),
  );
  return file;
}
module.exports = { styles, writeFixture };
if (require.main === module)
  for (const style of styles)
    console.log(
      writeFixture(path.join(process.argv[2] || 'artifacts/generic-fixtures', style.id), style),
    );
