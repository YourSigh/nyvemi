const aliases = {
  face: 'head',
  front_hair: 'front_hair',
  hair_front: 'front_hair',
  rear_hair: 'back_hair',
  hair_back: 'back_hair',
  rear_hair_left: 'back_hair_left',
  hair_back_left: 'back_hair_left',
  rear_hair_right: 'back_hair_right',
  hair_back_right: 'back_hair_right',
  left_arm: 'arm_left',
  right_arm: 'arm_right',
  torso: 'body',
};
function normalizeName(name) {
  const key = String(name)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return aliases[key] || key;
}
function validateManifest(source) {
  const match = /^(\d+)x(\d+)$/.exec(source.size || '');
  if (!match) throw Error('Material canvas size must be WIDTHxHEIGHT');
  const width = Number(match[1]),
    height = Number(match[2]);
  if (width < 16 || height < 16 || width > 4096 || height > 4096)
    throw Error('Material canvas must be 16–4096 pixels per dimension');
  if (!Array.isArray(source.layers) || source.layers.length < 1 || source.layers.length > 24)
    throw Error('Material must have 1–24 parts');
  const names = new Set();
  let pixels = 0;
  for (const l of source.layers) {
    const name = normalizeName(l.name);
    if (!name || names.has(name)) throw Error(`Duplicate or empty material part: ${name}`);
    names.add(name);
    const box = l.bounding_box?.absolute;
    if (!Array.isArray(box) || box.length !== 4 || box.some((v) => !Number.isSafeInteger(v)))
      throw Error(`Invalid bounding box: ${name}`);
    const [x, y, r, b] = box;
    if (
      r <= x ||
      b <= y ||
      x < -width / 4 ||
      y < -height / 4 ||
      r > width * 1.25 ||
      b > height * 1.25
    )
      throw Error(`Material bounds outside canvas allowance: ${name}`);
    if (typeof l.file !== 'string' || !/^[\w.-]+\.(png|jpe?g)$/i.test(l.file))
      throw Error(`Material file must be a local image filename: ${name}`);
    pixels += (r - x) * (b - y);
  }
  if (pixels > 40_000_000) throw Error('Material resampled area exceeds limit');
  return { width, height };
}
module.exports = { normalizeName, validateManifest };
