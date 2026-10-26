const fs = require('node:fs');
const { PNG } = require('pngjs');
const { load } = require('./inspect.cjs');
async function render(file, out, pose = {}) {
  const { rt, rig, set } = await load(file);
  rt.p2l_behaviors(rig, 0);
  for (const [id, v] of Object.entries(pose)) set(id, v);
  for (let i = 0; i < 30; i++) rt.p2l_update(rig, 1 / 60);
  const width = 640,
    height = 640,
    at = rt.p2l_alloc(width * height * 4);
  if (!rt.p2l_render(rig, at, width, height, 0, 1)) throw Error('Mesh software renderer failed');
  const png = new PNG({ width, height });
  png.data.set(new Uint8Array(rt.memory.buffer, at, png.data.length));
  fs.writeFileSync(out, PNG.sync.write(png));
  rt.p2l_dealloc(at, width * height * 4);
  rt.p2l_rig_free(rig);
}
module.exports = { render };
if (require.main === module)
  render(process.argv[2], process.argv[3], JSON.parse(process.argv[4] || '{}')).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
