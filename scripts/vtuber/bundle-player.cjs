const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('src/avatar/driver.ts', 'utf8');
const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    removeComments: true,
  },
  reportDiagnostics: true,
});
if (result.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error))
  throw Error('Avatar driver transpilation failed');
fs.mkdirSync('assets/avatar', { recursive: true });
fs.writeFileSync(
  'assets/avatar/driver.txt',
  `(()=>{const exports={};${result.outputText}\nwindow.NyvemiAvatarDriver=exports;})();`,
);
