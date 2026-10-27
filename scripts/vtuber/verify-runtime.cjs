const fs = require('node:fs');
const { load } = require('./inspect.cjs');
async function verifyRig(file, output) {
  const { rt, rig, params, str, set } = await load(file);
  const required = [
    'ParamAngleX',
    'ParamAngleY',
    'ParamAngleZ',
    'ParamEyeLOpen',
    'ParamEyeROpen',
    'ParamEyeBallX',
    'ParamEyeBallY',
    'ParamMouthOpenY',
    'ParamMouthForm',
    'ParamBreath',
  ];
  const missing = required.filter((id) => !params.includes(id));
  const count = rt.p2l_mesh_count(rig),
    size = 192,
    at = rt.p2l_alloc(size * size * 4);
  let vertices = 0;
  const frames = [];
  try {
    if (missing.length) throw Error(`Compiled model lacks facial controls: ${missing.join(', ')}`);
    if (count < 4) throw Error('Compiled model has too few meshes');
    rt.p2l_behaviors(rig, 0);
    for (const yaw of [-3, 0, 3]) {
      set('ParamAngleX', yaw);
      set('ParamAngleY', yaw / 2);
      set('ParamAngleZ', yaw / 4);
      set('ParamEyeLOpen', yaw === 0 ? 0 : 1);
      set('ParamEyeROpen', 1);
      set('ParamMouthOpenY', yaw === 0 ? 0.4 : 0);
      set('ParamBreath', yaw === 0 ? 1 : 0);
      for (let i = 0; i < 15; i++) rt.p2l_update(rig, 1 / 60);
      for (let m = 0; m < count; m++) {
        const n = rt.p2l_mesh_vertex_count(rig, m);
        if (yaw === 0) vertices += n;
        const points = new Float32Array(rt.memory.buffer, rt.p2l_mesh_vertices(rig, m), n * 2);
        if (points.some((v) => !Number.isFinite(v)))
          throw Error(`Non-finite geometry: ${str(rt.p2l_mesh_id(rig, m))}`);
      }
      if (!rt.p2l_render(rig, at, size, size, 0, 1)) throw Error('Compiled model cannot render');
      const pixels = new Uint8Array(rt.memory.buffer, at, size * size * 4);
      let visible = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 128) visible++;
      if (visible < 64) throw Error('Compiled model is empty in motion preview');
      frames.push({ yaw, visiblePixels: visible });
    }
    const meshIds = Array.from({ length: count }, (_, i) => str(rt.p2l_mesh_id(rig, i)));
    const response = {};
    for (const [parameter, meshName, value] of [
      ['ParamAngleX', 'ArtMeshFace', 3],
      ['ParamEyeBallX', 'ArtMeshIridesL', 0.4],
      ['ParamMouthOpenY', 'ArtMeshMouthOpen', 0.4],
    ]) {
      const mesh = meshIds.indexOf(meshName);
      if (mesh < 0) throw Error(`Missing parameter target mesh: ${meshName}`);
      set(parameter, 0);
      rt.p2l_evaluate(rig);
      const n = rt.p2l_mesh_vertex_count(rig, mesh) * 2;
      const before = Array.from(
        new Float32Array(rt.memory.buffer, rt.p2l_mesh_vertices(rig, mesh), n),
      );
      set(parameter, value);
      rt.p2l_evaluate(rig);
      const after = new Float32Array(rt.memory.buffer, rt.p2l_mesh_vertices(rig, mesh), n);
      const movement = Math.max(...before.map((v, i) => Math.abs(v - after[i])));
      if (movement < 0.001) throw Error(`Parameter has no mesh response: ${parameter}`);
      response[parameter] = movement;
    }
    const report = {
      checks: 'structural-and-render-smoke',
      response,
      meshes: count,
      vertices,
      parameters: params,
      gentleActions: ['nod', 'shake', 'wink', 'smile'],
      largeActions: 'not-calibrated',
      frames,
    };
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    return report;
  } finally {
    rt.p2l_dealloc(at, size * size * 4);
    rt.p2l_rig_free(rig);
  }
}
module.exports = { verifyRig };
if (require.main === module)
  verifyRig(process.argv[2], process.argv[3])
    .then((r) => console.log(`Verified ${r.meshes} meshes, ${r.frames.length} render poses`))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
