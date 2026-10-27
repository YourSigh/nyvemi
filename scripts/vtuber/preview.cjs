const { Buffer } = require('node:buffer');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { spawn } = require('node:child_process');
const ts = require('typescript');
const { PNG } = require('pngjs');
const { load } = require('./inspect.cjs');
async function main() {
  const file = process.argv[2],
    out = process.argv[3],
    { rt, rig, set, params } = await load(file);
  const compiled = ts.transpileModule(fs.readFileSync('src/avatar/driver.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = { exports: {} };
  vm.runInNewContext(compiled, context);
  const range = rt.p2l_alloc(12);
  const player = {
    parameterRanges: () =>
      params.map((id, i) => {
        rt.p2l_parameter_range(rig, i, range, range + 4, range + 8);
        const [min, max, value] = new Float32Array(rt.memory.buffer, range, 3);
        return { id, min, max, default: value };
      }),
    setParameter: set,
    behaviors: (f) => rt.p2l_behaviors(rig, f),
    update: (dt) => rt.p2l_update(rig, dt),
    draw: () => {},
  };
  const driver = context.exports.createDriver(player, () => 0.42),
    size = 400,
    at = rt.p2l_alloc(size * size * 4),
    fps = 24;
  const ff = spawn(
    '/opt/homebrew/bin/ffmpeg',
    [
      '-y',
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgba',
      '-video_size',
      `${size}x${size}`,
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      out,
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );
  const actions = process.argv[4] === 'actions';
  const scenes = actions
    ? ['nod', 'shake', 'wink', 'smile']
    : ['idle', 'thinking', 'talking', 'talking', 'happy', 'shy', 'sleepy', 'idle'];
  const sceneFrames = fps * (actions ? 3 : 1);
  for (let f = 0; f < sceneFrames * scenes.length; f++) {
    const scene = scenes[Math.floor(f / sceneFrames)];
    driver.setInput({ state: actions ? 'idle' : scene });
    if (actions && f % sceneFrames === 0 && !driver.play(scene))
      throw Error(`Unsupported preview action: ${scene}`);
    driver.step(1 / fps);
    if (!rt.p2l_render(rig, at, size, size, 0, 1)) throw Error('Frame render failed');
    const b = new Uint8Array(rt.memory.buffer, at, size * size * 4),
      frame = Buffer.from(b);
    for (let i = 0; i < frame.length; i += 4) {
      const a = frame[i + 3] / 255;
      frame[i] = Math.round(frame[i] * a + 255 * (1 - a));
      frame[i + 1] = Math.round(frame[i + 1] * a + 247 * (1 - a));
      frame[i + 2] = Math.round(frame[i + 2] * a + 250 * (1 - a));
      frame[i + 3] = 255;
    }
    if (f % sceneFrames === Math.floor(fps / 2)) {
      const png = new PNG({ width: size, height: size });
      png.data.set(frame);
      fs.writeFileSync(
        path.join(path.dirname(out), `pose-${Math.floor(f / sceneFrames)}-${scene}.png`),
        PNG.sync.write(png),
      );
    }
    if (!ff.stdin.write(frame)) await new Promise((resolve) => ff.stdin.once('drain', resolve));
  }
  ff.stdin.end();
  await new Promise((resolve, reject) =>
    ff.on('exit', (code) => (code === 0 ? resolve() : reject(Error('ffmpeg failed')))),
  );
  rt.p2l_dealloc(at, size * size * 4);
  rt.p2l_rig_free(rig);
  console.log('Rendered actual mesh/physics state sequence');
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
