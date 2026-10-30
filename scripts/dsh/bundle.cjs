const fs = require('node:fs'),
  path = require('node:path'),
  esbuild = require('esbuild'),
  crypto = require('node:crypto');
fs.mkdirSync('vendor/dsh-runtime', { recursive: true });
const root = path.resolve('vendor/deepseek-harness');
const config = Object.fromEntries(
  Object.entries(require('../../vendor/deepseek-harness/resolution.json')).map(([k, v]) => [
    k,
    [v],
  ]),
);
(async () => {
  const transform = await esbuild.build({
    entryPoints: [
      path.join(root, 'packages/experimental/webworker-runtime/src/compile/transform.ts'),
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', transform.outputFiles[0].text)(
    require,
    mod,
    mod.exports,
  );
  const lower = mod.exports.lowerModuleSource;
  const proxies =
    "'node:path': './node/builtin_modules/implemented/path.ts', 'node:crypto': './node/builtin_modules/implemented/crypto.ts', 'node:async_hooks': './node/builtin_modules/implemented/async_hooks.ts', 'node:util/types': './node/builtin_modules/implemented/util/types.ts'";
  const proxyMap = Object.fromEntries(
    [...proxies.matchAll(/'([^']+)': '\.\/(node\/[^']+)'/g)].map((m) => [
      m[1],
      path.join(root, 'packages/experimental/webworker-runtime/src', m[2]),
    ]),
  );
  await esbuild
    .build({
      entryPoints: ['scripts/dsh/entry.mjs'],
      write: false,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      metafile: true,
      define: { structuredClone: 'mobileClone', TextEncoder: 'MobileTextEncoder' },
      inject: ['scripts/dsh/als.ts'],
      nodePaths: [path.resolve('node_modules')],
      tsconfigRaw: { compilerOptions: {} },
      plugins: [
        {
          name: 'dsh-mobile',
          setup(b) {
            b.onResolve({ filter: /^(@deepseek-ai\/|node:|zod$)/ }, (a) => {
              if (a.path === 'zod') return { path: require.resolve('dsh-zod') };
              if (proxyMap[a.path]) return { path: proxyMap[a.path] };
              if (config[a.path]) {
                let p = path.resolve(root, config[a.path][0]);
                if (fs.statSync(p).isDirectory()) p = path.join(p, 'index.ts');
                return { path: p };
              }
              throw Error('Unmapped ' + a.path);
            });
            b.onLoad({ filter: /\.(ts|js|mjs)$/ }, async (a) => {
              if (!a.path.startsWith(root) || a.path.includes('webworker-runtime')) return;
              let raw = await fs.promises.readFile(a.path, 'utf8');
              if (a.path.endsWith('/llm/src/attribution.ts')) {
                raw = raw
                  .replace(/import \{ createRequire \} from 'node:module'/, '')
                  .replace(
                    /const \{ version \} = createRequire[^\n]+/,
                    'const version = \"0.2.2-alpha.2\"',
                  );
              }
              const compiled = await esbuild.transform(raw, {
                loader: a.path.endsWith('.ts') ? 'ts' : 'js',
                format: 'esm',
                target: 'es2022',
              });
              return { contents: compiled.code, loader: 'js' };
            });
          },
        },
      ],
    })
    .then(async (r) => {
      fs.writeFileSync('artifacts/dsh-meta.json', JSON.stringify(r.metafile));
      const lowered = lower({ filename: 'dsh-core.js', source: r.outputFiles[0].text }).code;
      const compiled = await esbuild.transform(lowered, {
        loader: 'js',
        format: 'cjs',
        target: 'es2017',
        supported: { bigint: true },
      });
      const code = compiled.code.replace(/[ \t]+$/gm, '');
      fs.writeFileSync('vendor/dsh-runtime/index.js', code);
      fs.writeFileSync(
        'vendor/dsh-runtime/build.json',
        JSON.stringify(
          {
            upstream: require('../../vendor/deepseek-harness/UPSTREAM.json'),
            sha256: crypto.createHash('sha256').update(code).digest('hex'),
            bytes: Buffer.byteLength(code),
          },
          null,
          2,
        ) + '\n',
      );
      console.log('DSH bundle:', Buffer.byteLength(code), 'bytes');
    });
})();
