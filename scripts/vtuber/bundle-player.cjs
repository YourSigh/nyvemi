const fs = require('node:fs');
const ts = require('typescript');
let bundle = '(()=>{const shared={};';
for (const file of ['src/avatar/driver.ts', 'src/avatar/interactions.ts']) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      removeComments: true,
    },
    reportDiagnostics: true,
  });
  if (result.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error))
    throw Error('Avatar transpilation failed');
  bundle += `(()=>{const exports=shared;${result.outputText}\n})();`;
}
bundle += 'window.NyvemiAvatarDriver=shared;})();';
fs.mkdirSync('assets/avatar', { recursive: true });
fs.writeFileSync('assets/avatar/driver.txt', bundle);
