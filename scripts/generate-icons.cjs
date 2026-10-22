// Code-native vector mark, rasterized for Android launcher requirements.
const fs = require('node:fs');
const { PNG } = require('pngjs');
const image = new PNG({ width: 1024, height: 1024 });
const n = [
  [350, 682],
  [350, 350],
  [422, 350],
  [602, 566],
  [602, 350],
  [674, 350],
  [674, 682],
  [602, 682],
  [422, 466],
  [422, 682],
];
function inside(x, y, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      hit = !hit;
  }
  return hit;
}
for (let y = 0; y < 1024; y++)
  for (let x = 0; x < 1024; x++) {
    let color = [255, 247, 250];
    if ((x - 512) ** 2 + (y - 512) ** 2 <= 310 ** 2) color = [252, 228, 238];
    if (inside(x, y, n)) color = [216, 107, 150];
    if ((x - 713) ** 2 + (y - 309) ** 2 <= 47 ** 2) color = [255, 255, 255];
    if ((x - 713) ** 2 + (y - 309) ** 2 <= 20 ** 2) color = [236, 170, 197];
    const i = (y * 1024 + x) * 4;
    image.data.set([...color, 255], i);
  }
fs.writeFileSync('assets/nyvemi-icon.png', PNG.sync.write(image));
