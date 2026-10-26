const fs = require('node:fs');
async function load(file) {
  const { instance } = await WebAssembly.instantiate(
      fs.readFileSync('vendor/psd2live-runtime/runtime.wasm'),
      {},
    ),
    rt = instance.exports,
    bytes = fs.readFileSync(file),
    at = rt.p2l_alloc(bytes.length),
    error = rt.p2l_alloc(1024);
  new Uint8Array(rt.memory.buffer, at, bytes.length).set(bytes);
  const rig = rt.p2l_rig_load(at, bytes.length, error, 1024);
  rt.p2l_dealloc(at, bytes.length);
  const str = (ptr) => {
    const b = new Uint8Array(rt.memory.buffer);
    let end = ptr;
    while (b[end]) end++;
    return new TextDecoder().decode(b.subarray(ptr, end));
  };
  if (!rig) throw Error(str(error));
  rt.p2l_dealloc(error, 1024);
  const params = Array.from({ length: rt.p2l_parameter_count(rig) }, (_, i) =>
    str(rt.p2l_parameter_id(rig, i)),
  );
  const set = (id, value) => {
    const i = params.indexOf(id);
    if (i >= 0) rt.p2l_set_parameter(rig, i, value);
  };
  return { rt, rig, params, set, str };
}
async function main() {
  const file = process.argv[2];
  const { rt, rig, params, str } = await load(file);
  const chunks = {};
  const b = fs.readFileSync(file),
    count = b.readUInt32LE(16);
  for (let i = 0; i < count; i++) {
    const at = 32 + i * 40,
      tag = b.toString('ascii', at, at + 4);
    chunks[tag] = Number(b.readBigUInt64LE(at + 16));
  }
  console.log(
    JSON.stringify(
      {
        parameters: params,
        meshes: Array.from({ length: rt.p2l_mesh_count(rig) }, (_, i) => ({
          id: str(rt.p2l_mesh_id(rig, i)),
          vertices: rt.p2l_mesh_vertex_count(rig, i),
        })),
        chunks,
      },
      null,
      2,
    ),
  );
}
module.exports = { load };
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
