import { URL } from 'node:url';
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const runtime = new URL('../vendor/psd2live-runtime/runtime.wasm', import.meta.url),
  model = new URL('../assets/avatar/tongza.p2lrt', import.meta.url);
type Native = Record<string, (...args: number[]) => number> & { memory: WebAssembly.Memory };
async function load() {
  const module = await WebAssembly.compile(new Uint8Array(readFileSync(runtime)).buffer);
  const instance = await WebAssembly.instantiate(module, {});
  const rt = instance.exports as unknown as Native;
  const bytes = readFileSync(model),
    at = rt.p2l_alloc(bytes.length),
    err = rt.p2l_alloc(512);
  new Uint8Array(rt.memory.buffer, at, bytes.length).set(bytes);
  const rig = rt.p2l_rig_load(at, bytes.length, err, 512);
  expect(rig).toBeGreaterThan(0);
  rt.p2l_dealloc(at, bytes.length);
  const str = (ptr: number) => {
    const b = new Uint8Array(rt.memory.buffer);
    let end = ptr;
    while (b[end]) end++;
    return new TextDecoder().decode(b.subarray(ptr, end));
  };
  const ids = Array.from({ length: rt.p2l_parameter_count(rig) }, (_, i) =>
    str(rt.p2l_parameter_id(rig, i)),
  );
  const meshes = Array.from({ length: rt.p2l_mesh_count(rig) }, (_, i) =>
    str(rt.p2l_mesh_id(rig, i)),
  );
  const set = (id: string, value: number) => {
    const i = ids.indexOf(id);
    expect(i).toBeGreaterThanOrEqual(0);
    rt.p2l_set_parameter(rig, i, value);
  };
  const vertices = (id: string) => {
    const i = meshes.indexOf(id);
    expect(i).toBeGreaterThanOrEqual(0);
    return Array.from(
      new Float32Array(
        rt.memory.buffer,
        rt.p2l_mesh_vertices(rig, i),
        rt.p2l_mesh_vertex_count(rig, i) * 2,
      ),
    );
  };
  return { rt, rig, ids, meshes, set, vertices };
}
it('loads the actual PSD2Live model with all required facial and physics parameter families', async () => {
  const { rt, rig, ids, meshes } = await load();
  for (const id of [
    'ParamAngleX',
    'ParamAngleY',
    'ParamAngleZ',
    'ParamEyeLOpen',
    'ParamEyeROpen',
    'ParamEyeBallX',
    'ParamEyeBallY',
    'ParamMouthOpenY',
    'ParamMouthForm',
    'ParamBodyAngleZ',
    'ParamBreath',
    'ParamHairBack',
    'ParamSwingClothes',
    'ParamSwingPonyL_1',
    'ParamSwingPonyR_1',
  ])
    expect(ids).toContain(id);
  expect(meshes).toContain('ArtMeshBackHairL');
  expect(meshes).toContain('ArtMeshBackHairR');
  expect(meshes.length).toBeGreaterThan(14);
  rt.p2l_rig_free(rig);
});
it('head yaw changes local face edge-length ratios rather than applying a whole-image affine transform', async () => {
  const { rt, rig, set, vertices } = await load();
  const a = vertices('ArtMeshFace');
  set('ParamAngleX', 25);
  rt.p2l_evaluate(rig);
  const b = vertices('ArtMeshFace');
  const ratios: number[] = [];
  for (let i = 0; i < a.length - 2; i += 8) {
    const j = (i + Math.floor(a.length / 4) * 2) % a.length;
    const da = Math.hypot(a[i] - a[j], a[i + 1] - a[j + 1]),
      db = Math.hypot(b[i] - b[j], b[i + 1] - b[j + 1]);
    if (da > 10) ratios.push(db / da);
  }
  expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0.01);
  rt.p2l_rig_free(rig);
});
it('gaze moves irises independently and head motion excites the runtime hair pendulum', async () => {
  const { rt, rig, set, vertices, ids } = await load();
  const eye = vertices('ArtMeshIridesL'),
    face = vertices('ArtMeshFace');
  set('ParamEyeBallX', 1);
  rt.p2l_evaluate(rig);
  expect(vertices('ArtMeshIridesL')).not.toEqual(eye);
  expect(vertices('ArtMeshFace')).toEqual(face);
  set('ParamAngleX', 20);
  const samples: number[] = [];
  for (let i = 0; i < 90; i++) {
    rt.p2l_update(rig, 1 / 60);
    samples.push(
      new Float32Array(rt.memory.buffer, rt.p2l_parameter_current(rig), ids.length)[
        ids.indexOf('ParamHairBack')
      ],
    );
  }
  expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.001);
  rt.p2l_rig_free(rig);
});
