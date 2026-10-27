const fs = require('node:fs'),
  path = require('node:path'),
  net = require('node:net'),
  crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { prepare } = require('./prepare.cjs'),
  { convert } = require('./psd.cjs');
async function main() {
  const input = path.resolve(process.argv[2] || ''),
    output = path.resolve(process.argv[3] || 'artifacts/avatar-output'),
    name = process.argv[4] || 'avatar';
  if (!/^[\w-]+$/.test(name)) throw Error('Use a simple ASCII output name');
  const compiler = path.resolve(process.env.PSD2LIVE_HOME || 'artifacts/psd2live');
  if (!fs.existsSync(path.join(compiler, 'gradlew'))) throw Error('Run npm run avatar:setup first');
  const source = JSON.parse(fs.readFileSync(input));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(input));
  for (const l of source.layers)
    hash.update(fs.readFileSync(path.join(path.dirname(input), l.file)));
  for (const file of [
    'scripts/vtuber/prepare.cjs',
    'scripts/vtuber/occlusion.cjs',
    'scripts/vtuber/material.cjs',
    'scripts/vtuber/verify-runtime.cjs',
    'scripts/vtuber/psd.cjs',
    'scripts/vtuber/physics.py',
  ])
    hash.update(fs.readFileSync(file));
  const fingerprint = hash.digest('hex'),
    receipt = path.join(output, 'compile-receipt.json');
  if (fs.existsSync(receipt)) {
    const old = JSON.parse(fs.readFileSync(receipt));
    if (old.fingerprint === fingerprint) {
      console.log('Reusing completed local rig:', old.model);
      return;
    }
    throw Error('Output already contains a different rig; choose a new output directory');
  }
  fs.mkdirSync(output, { recursive: true });
  const prepared = path.join(output, 'prepared/layers.json');
  prepare(input, prepared);
  convert(prepared, path.join(output, `${name}.psd`));
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const p = server.address().port;
      server.close(() => resolve(p));
    });
  });
  const java =
    process.env.PSD2LIVE_JAVA_HOME ||
    (fs.existsSync('/Applications/Android Studio.app/Contents/jbr/Contents/Home')
      ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
      : process.env.JAVA_HOME);
  const fd = fs.openSync(path.join(output, 'mcp.log'), 'w');
  const child = spawn(
    path.join(compiler, 'gradlew'),
    [
      'run',
      `--args=mcp --port ${port} --store ${JSON.stringify(path.join(output, 'workspace'))} --profile full`,
      '-x',
      'buildRuntime',
      '--console=plain',
    ],
    {
      cwd: compiler,
      env: { ...process.env, ...(java ? { JAVA_HOME: java } : {}) },
      stdio: ['ignore', fd, fd],
    },
  );
  let serverPid;
  try {
    const start = Date.now();
    while (true) {
      if (child.exitCode !== null) throw Error('Compiler startup failed; inspect mcp.log');
      const log = fs.readFileSync(path.join(output, 'mcp.log'), 'utf8');
      if (/^endpoint /m.test(log) && /^token /m.test(log)) break;
      if (Date.now() - start > 20 * 60_000) throw Error('Compiler startup timeout');
      await new Promise((r) => setTimeout(r, 1000));
    }
    serverPid = Number(
      execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim(),
    );
    execFileSync(
      'python3',
      [
        path.resolve('scripts/vtuber/physics.py'),
        '--work',
        output,
        '--name',
        name,
        '--compiler',
        compiler,
        '--port',
        String(port),
      ],
      { stdio: 'inherit' },
    );
    const model = path.join(output, 'web-physics', `${name}.p2lrt`);
    if (!fs.existsSync(model)) throw Error('Compiler produced no model');
    const { verifyRig } = require('./verify-runtime.cjs');
    await verifyRig(model, path.join(output, 'runtime-report.json'));
    fs.writeFileSync(
      receipt,
      JSON.stringify(
        {
          fingerprint,
          model,
          compilerRevision: '692986728e2b7b9254a41a22bdce1656bc0c12f9',
          kind: 'mesh-deformer-physics',
        },
        null,
        2,
      ),
    );
    console.log('Finished automatic rig:', model);
  } finally {
    if (serverPid) {
      const command = execFileSync('ps', ['-p', String(serverPid), '-o', 'command='], {
        encoding: 'utf8',
      });
      if (command.includes('io.github.psd2live.MainKt') && command.includes(`--port ${port}`))
        process.kill(serverPid, 'SIGTERM');
    }
    child.kill('SIGTERM');
    fs.closeSync(fd);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
