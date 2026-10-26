// PSD2Live web player: plays a .p2lrt rig with the PSD2Live runtime (WebAssembly) on a WebGL canvas.
// MIT License.
//
//   import { P2LPlayer } from "./p2l.js";
//   const player = await P2LPlayer.create(canvas, "p2l_runtime.wasm", "model.p2lrt");
//   player.play("Idle"); player.lookAt(0.5, 0.2); player.lipSync(0.8);
//
// Drawing follows the runtime header's rules (p2l_runtime.h, "Drawing") on premultiplied color, WebGL 1:
// - Normal under over and Cubism's add and multiply use blend functions. Every other pair of a color blend
//   mode (W3C blend functions) and an alpha blend mode (over, atop, out, conjoint and disjoint over) reads
//   the destination: the pixels under the mesh are copied into a texture and a shader composites onto them.
// - Isolated groups (p2l_render_commands) draw their meshes into a cleared layer texture, then composite
//   the layer with the group's opacity, multiply and screen colors, masks and blend modes.
// - Masks write the stencil where a mask texel is at least half opaque (coverage 1, else 0); a group's
//   masks do the same on the target the group composites onto.
// Without layer framebuffers isolated groups draw as their meshes alone.

const BLINK = 1, BREATH = 2, LOOK = 4, LIP_SYNC = 8;

const VERTEX = `
attribute vec2 position;
attribute vec2 uv;
uniform vec4 view; // scale x, scale y, offset x, offset y
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position * view.xy + view.zw, 0.0, 1.0);
}`;

// A quad over the whole target; the scissor limits it to the pixels a layer holds.
const QUAD_VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

// The header's compositing of a premultiplied source s over the destination d.
const COMPOSITE = `
uniform sampler2D destination;
uniform vec2 targetSize;
uniform int colorBlend;
uniform int alphaBlend;

float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }

vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}

vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }

float sat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }

vec3 setSat(vec3 c, float s) {
  float lo = min(c.r, min(c.g, c.b));
  float hi = max(c.r, max(c.g, c.b));
  return hi > lo ? (c - lo) * s / (hi - lo) : vec3(0.0);
}

// W3C HardLight(Cb, Cs): multiply below one half, screen above.
float hardLight(float b, float s) {
  if (s <= 0.5) return b * 2.0 * s;
  float t = 2.0 * s - 1.0;
  return b + t - b * t;
}

float softLightD(float b) { return b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b); }

// The separable blend function B(Cb, Cs) of the color blend mode.
float separable(float b, float s) {
  if (colorBlend == 1 || colorBlend == 3 || colorBlend == 4) return min(1.0, b + s);
  if (colorBlend == 2 || colorBlend == 6) return b * s;
  if (colorBlend == 5) return min(b, s);
  if (colorBlend == 7) return b >= 1.0 ? 1.0 : (s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s));
  if (colorBlend == 8) return max(0.0, b + s - 1.0);
  if (colorBlend == 9) return max(b, s);
  if (colorBlend == 10) return b + s - b * s;
  if (colorBlend == 11) return b <= 0.0 ? 0.0 : (s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s)));
  if (colorBlend == 12) return hardLight(s, b);
  if (colorBlend == 13) return s <= 0.5 ? b - (1.0 - 2.0 * s) * b * (1.0 - b) : b + (2.0 * s - 1.0) * (softLightD(b) - b);
  if (colorBlend == 14) return hardLight(b, s);
  if (colorBlend == 15) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
  return s;
}

vec3 blendColor(vec3 b, vec3 s) {
  if (colorBlend == 16) return setLum(setSat(s, sat(b)), lum(b));
  if (colorBlend == 17) return setLum(s, lum(b));
  return vec3(separable(b.r, s.r), separable(b.g, s.g), separable(b.b, s.b));
}

vec4 composite(vec4 s) {
  vec4 d = texture2D(destination, gl_FragCoord.xy / targetSize);
  vec4 o;
  if (colorBlend == 1) {
    o = vec4(s.rgb + d.rgb, d.a);
  } else if (colorBlend == 2) {
    o = vec4(s.rgb * d.rgb + d.rgb * (1.0 - s.a), d.a);
  } else if (colorBlend == 0 && alphaBlend == 0) {
    o = s + d * (1.0 - s.a);
  } else {
    float sa = s.a, da = d.a;
    vec3 cs = sa > 0.0 ? clamp(s.rgb / sa, 0.0, 1.0) : vec3(0.0);
    vec3 cb = da > 0.0 ? clamp(d.rgb / da, 0.0, 1.0) : vec3(0.0);
    // How much of the source overlaps the destination, by the alpha mode's coverage model.
    float p = alphaBlend == 3 ? min(sa, da) : (alphaBlend == 4 ? max(sa + da - 1.0, 0.0) : sa * da);
    float w = sa > 0.0 ? p / sa : 0.0;
    vec3 m = (1.0 - w) * cs + w * blendColor(cb, cs);
    // Porter-Duff factors: over, atop, out (the source erases), conjoint and disjoint over.
    float fa = 1.0, fb = 1.0 - sa;
    if (alphaBlend == 1) fa = da;
    else if (alphaBlend == 2) fa = 0.0;
    else if (alphaBlend == 3) fb = (da <= 0.0 || sa >= da) ? 0.0 : 1.0 - sa / da;
    else if (alphaBlend == 4) fb = da <= 0.0 ? 0.0 : min(1.0, (1.0 - sa) / da);
    o = vec4(sa * fa * m + da * fb * cb, sa * fa + da * fb);
  }
  return clamp(o, 0.0, 1.0);
}
`;

// A mesh's fragment on premultiplied texels: multiply, then screen, then opacity.
const MESH = `
uniform sampler2D tex;
uniform vec3 multiply;
uniform vec3 screen;
uniform float opacity;
uniform float maskThreshold; // above zero: draw as a mask, keeping only covered pixels
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tex, vUv);
  if (maskThreshold > 0.0) {
    if (c.a < maskThreshold) discard;
    gl_FragColor = vec4(0.0);
    return;
  }
  c.rgb *= multiply;
  c.rgb += screen * c.a - c.rgb * screen;
  c *= opacity;
#ifdef COMPOSITE
  gl_FragColor = composite(c);
#else
  gl_FragColor = c;
#endif
}`;

// An isolated group's layer pixel: unpremultiplied, multiply, then screen; alpha scaled by the opacity.
const GROUP = `
uniform sampler2D layer;
uniform vec2 layerSize;
uniform vec3 multiply;
uniform vec3 screen;
uniform float opacity;
void main() {
  vec4 l = texture2D(layer, gl_FragCoord.xy / layerSize) * opacity;
  vec3 c = l.a > 0.0 ? clamp(l.rgb / l.a, 0.0, 1.0) : vec3(0.0);
  c *= multiply;
  c = c + screen - c * screen;
  vec4 s = vec4(c * l.a, l.a);
#ifdef COMPOSITE
  gl_FragColor = composite(s);
#else
  gl_FragColor = s;
#endif
}`;

/** Whether the pair of a color and an alpha blend mode composites with blend functions. */
function fixedFunction(blend, alphaBlend) {
  return blend === 1 || blend === 2 || (blend === 0 && alphaBlend === 0);
}

export class P2LPlayer {
  /** Loads the runtime and a rig and starts drawing on [canvas]. */
  static async create(canvas, wasmUrl, rigUrl) {
    const [wasm, rig] = await Promise.all([
      fetch(wasmUrl).then((r) => r.arrayBuffer()),
      fetch(rigUrl).then((r) => r.arrayBuffer()),
    ]);
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const player = new P2LPlayer(canvas, instance.exports, new Uint8Array(rig));
    await player.loadTextures();
    player.start();
    return player;
  }

  /** A player on an instantiated [runtime] (whose exports several players may share) for [bytes] of a rig; not started. */
  static async fromBytes(canvas, runtime, bytes) {
    const player = new P2LPlayer(canvas, runtime, bytes);
    await player.loadTextures();
    return player;
  }

  constructor(canvas, runtime, bytes) {
    this.canvas = canvas;
    this.rt = runtime;
    const at = runtime.p2l_alloc(bytes.length);
    new Uint8Array(runtime.memory.buffer, at, bytes.length).set(bytes);
    const error = runtime.p2l_alloc(512);
    this.rig = runtime.p2l_rig_load(at, bytes.length, error, 512);
    runtime.p2l_dealloc(at, bytes.length);
    if (!this.rig) {
      const message = this.string(error);
      runtime.p2l_dealloc(error, 512);
      throw new Error("The rig could not be loaded: " + message);
    }
    runtime.p2l_dealloc(error, 512);
    runtime.p2l_behaviors(this.rig, BLINK | BREATH | LOOK);

    const width = runtime.p2l_alloc(8);
    runtime.p2l_canvas(this.rig, width, width + 4);
    [this.width, this.height] = new Float32Array(runtime.memory.buffer, width, 2);
    runtime.p2l_dealloc(width, 8);

    this.clips = this.list(runtime.p2l_clip_count, runtime.p2l_clip_id);
    this.parameters = this.list(runtime.p2l_parameter_count, runtime.p2l_parameter_id);
    this.expressions = this.list(runtime.p2l_expression_count, runtime.p2l_expression_id);
    this.hitAreas = this.list(runtime.p2l_hit_area_count, runtime.p2l_hit_area_id);
    /** What advanced mode the file offers: 1 skinning, 2 exact links, 4 live simulation, 8 collision. */
    this.advancedFeatures = runtime.p2l_advanced_available(this.rig);
    this.meshes = [];
    const count = runtime.p2l_mesh_count(this.rig);
    const scratch = runtime.p2l_alloc(16);
    for (let m = 0; m < count; m++) {
      const vertices = runtime.p2l_mesh_vertex_count(this.rig, m);
      const indexPointer = runtime.p2l_mesh_indices(this.rig, m, scratch);
      const indexCount = new Uint32Array(runtime.memory.buffer, scratch, 1)[0];
      const blend = runtime.p2l_mesh_blend(this.rig, m, scratch + 4);
      const culling = new Uint8Array(runtime.memory.buffer, scratch + 4, 1)[0] !== 0;
      const alphaBlend = runtime.p2l_mesh_alpha_blend(this.rig, m);
      const masks = this.indices((out, capacity, inverted) => runtime.p2l_mesh_masks(this.rig, m, out, capacity, inverted), true);
      this.meshes.push({
        vertices,
        uvs: new Float32Array(new Float32Array(runtime.memory.buffer, runtime.p2l_mesh_uvs(this.rig, m), vertices * 2)),
        indices: new Uint32Array(new Uint32Array(runtime.memory.buffer, indexPointer, indexCount)),
        texture: runtime.p2l_mesh_texture(this.rig, m),
        blend,
        alphaBlend,
        culling,
        fixed: fixedFunction(blend, alphaBlend),
        masks: masks.list,
        invertMask: masks.inverted,
      });
    }
    // Each part's isolated group: its blend modes, mask inversion and masks.
    this.groups = [];
    const parts = runtime.p2l_part_count(this.rig);
    for (let p = 0; p < parts; p++) {
      runtime.p2l_part_group(this.rig, p, scratch, scratch + 4, scratch + 8);
      const [blend, alphaBlend] = new Int32Array(runtime.memory.buffer, scratch, 2);
      const invertMask = new Uint8Array(runtime.memory.buffer, scratch + 8, 1)[0] !== 0;
      const masks = this.indices((out, capacity) => runtime.p2l_part_masks(this.rig, p, out, capacity), false).list;
      this.groups.push({ blend, alphaBlend, invertMask, masks, fixed: fixedFunction(blend, alphaBlend) });
    }
    runtime.p2l_dealloc(scratch, 16);
    // Every mesh, and each isolated group's opening and closing.
    this.commandCapacity = count + 2 * parts;
    this.commandsPointer = runtime.p2l_alloc(this.commandCapacity * 4 + 4);
    this.colors = runtime.p2l_alloc(28);
    this.meshIds = this.list(runtime.p2l_mesh_count, runtime.p2l_mesh_id);
    this.bones = this.list(runtime.p2l_bone_count, runtime.p2l_bone_id);
    /** Zoom over the fitted view and a pan in element pixels. */
    this.view = { zoom: 1, x: 0, y: 0 };
    this.setupGl();
  }

  /**
   * Indices the runtime writes through [read](out, capacity, flag): counted first, then filled; [withFlag]
   * reads the bool it writes after them too.
   */
  indices(read, withFlag) {
    const rt = this.rt;
    const n = read(0, 0, 0);
    const out = rt.p2l_alloc(n * 4 + 4);
    read(out, n, withFlag ? out + n * 4 : 0);
    const list = Array.from(new Uint32Array(rt.memory.buffer, out, n));
    const inverted = withFlag && new Uint8Array(rt.memory.buffer, out + n * 4, 1)[0] !== 0;
    rt.p2l_dealloc(out, n * 4 + 4);
    return { list, inverted };
  }

  /** Each parameter's id with its range and default. */
  parameterRanges() {
    const rt = this.rt;
    const out = rt.p2l_alloc(12);
    const ranges = this.parameters.map((id, i) => {
      rt.p2l_parameter_range(this.rig, i, out, out + 4, out + 8);
      const [min, max, value] = new Float32Array(rt.memory.buffer, out, 3);
      return { id, min, max, default: value };
    });
    rt.p2l_dealloc(out, 12);
    return ranges;
  }

  /** The value every parameter had in the last evaluation, after clips, expressions, behaviors and physics. */
  parameterValues() {
    return Array.from(new Float32Array(this.rt.memory.buffer, this.rt.p2l_parameter_current(this.rig), this.parameters.length));
  }

  /** Mesh [m]'s vertices in canvas pixels at the last evaluation. */
  meshVertices(m) {
    return new Float32Array(this.rt.memory.buffer, this.rt.p2l_mesh_vertices(this.rig, m), this.meshes[m].vertices * 2);
  }

  /** The mesh indices hit area [i] covers. */
  hitAreaMeshes(i) {
    const n = this.rt.p2l_hit_area_meshes(this.rig, i, 0, 0);
    const out = this.rt.p2l_alloc(n * 4 + 4);
    this.rt.p2l_hit_area_meshes(this.rig, i, out, n);
    const meshes = Array.from(new Uint32Array(this.rt.memory.buffer, out, n));
    this.rt.p2l_dealloc(out, n * 4 + 4);
    return meshes;
  }

  /** Every bone's canvas frame [a, b, c, d, tx, ty] at the last evaluation, by id. */
  boneFrames() {
    const out = this.rt.p2l_alloc(24);
    const frames = [];
    this.bones.forEach((id, i) => {
      if (this.rt.p2l_bone_transform(this.rig, i, out)) frames.push({ id, m: Array.from(new Float32Array(this.rt.memory.buffer, out, 6)) });
    });
    this.rt.p2l_dealloc(out, 24);
    return frames;
  }

  /** The simulations' colliders as the last update placed them: [ax, ay, bx, by, radiusA, radiusB] in canvas pixels. */
  colliders() {
    const n = this.rt.p2l_sim_colliders(this.rig, 0, 0);
    if (n === 0) return [];
    const out = this.rt.p2l_alloc(n * 24);
    this.rt.p2l_sim_colliders(this.rig, out, n);
    const flat = Array.from(new Float32Array(this.rt.memory.buffer, out, n * 6));
    this.rt.p2l_dealloc(out, n * 24);
    return Array.from({ length: n }, (_, i) => flat.slice(i * 6, i * 6 + 6));
  }

  /** How many parts each pose group switches between. */
  poseGroups() {
    return Array.from({ length: this.rt.p2l_pose_group_count(this.rig) }, (_, g) => this.rt.p2l_pose_group_size(this.rig, g));
  }

  /** Shows part [entry] of pose group [group], fading the others out. */
  showPose(group, entry) {
    return this.rt.p2l_pose_show(this.rig, group, entry);
  }

  /** Starts the simulations again at rest. */
  resetSimulation() {
    this.rt.p2l_sim_reset(this.rig);
  }

  /** Wind besides the scenes' own, canvas pixels per second² (x right, y down). */
  wind(x, y) {
    this.rt.p2l_sim_wind(this.rig, x, y);
  }

  /** Behaviors: 1 blink, 2 breathing, 4 gaze, 8 lip sync. */
  behaviors(flags) {
    this.rt.p2l_behaviors(this.rig, flags);
  }

  /** The scale and offset that place the rig's canvas in the element (CSS pixels): x' = x * scale + left. */
  layout() {
    const r = this.canvas.getBoundingClientRect();
    const scale = Math.min(r.width / this.width, r.height / this.height) * this.view.zoom;
    return { scale, left: r.width / 2 + this.view.x - (this.width / 2) * scale, top: r.height / 2 + this.view.y - (this.height / 2) * scale, rect: r };
  }

  /** Frees the rig and its GPU objects; the player is unusable afterwards. */
  dispose() {
    this.stop();
    const gl = this.gl;
    for (const t of this.textures || []) gl.deleteTexture(t);
    for (const m of this.meshes) { gl.deleteBuffer(m.uvBuffer); gl.deleteBuffer(m.indexBuffer); }
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.quadBuffer);
    for (const layer of this.layers) { gl.deleteFramebuffer(layer.framebuffer); gl.deleteTexture(layer.texture); }
    gl.deleteTexture(this.destination);
    gl.deleteRenderbuffer(this.depthStencil);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.program);
    this.rt.p2l_dealloc(this.commandsPointer, this.commandCapacity * 4 + 4);
    this.rt.p2l_dealloc(this.colors, 28);
    this.rt.p2l_rig_free(this.rig);
    this.rig = 0;
  }

  string(pointer) {
    const bytes = new Uint8Array(this.rt.memory.buffer, pointer);
    let end = 0;
    while (bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(0, end));
  }

  list(count, id) {
    return Array.from({ length: count(this.rig) }, (_, i) => this.string(id(this.rig, i)));
  }

  setupGl() {
    // Premultiplied throughout, as the page composites the canvas.
    const gl = this.canvas.getContext("webgl", { stencil: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL is not available");
    // 32-bit indices where available; otherwise meshes past 65535 vertices cannot draw.
    const wide = gl.getExtension("OES_element_index_uint") != null;
    this.indexType = wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    if (!wide) {
      for (const mesh of this.meshes) {
        const indices = mesh.indices;
        for (let i = 0; i < indices.length; i++) {
          if (indices[i] > 65535) throw new Error("This model needs 32-bit mesh indices, which this browser's WebGL does not provide");
        }
        mesh.indices = new Uint16Array(indices);
      }
    }
    this.gl = gl;
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const link = (vertex, fragment, composite) => {
      const program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, PRECISION + (composite ? "#define COMPOSITE\n" + COMPOSITE : "") + fragment));
      // Every program reads positions at 0 and texture coordinates at 1.
      gl.bindAttribLocation(program, 0, "position");
      if (vertex === VERTEX) gl.bindAttribLocation(program, 1, "uv");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      const loc = {};
      const names = ["view", "tex", "multiply", "screen", "opacity", "maskThreshold", "layer", "layerSize", "destination", "targetSize", "colorBlend", "alphaBlend"];
      for (const name of names) loc[name] = gl.getUniformLocation(program, name);
      gl.useProgram(program);
      if (loc.tex) gl.uniform1i(loc.tex, 0);
      if (loc.layer) gl.uniform1i(loc.layer, 0);
      if (loc.destination) gl.uniform1i(loc.destination, 1);
      return { program, loc };
    };
    this.programs = {
      mesh: link(VERTEX, MESH, false),
      meshComposite: link(VERTEX, MESH, true),
      group: link(QUAD_VERTEX, GROUP, false),
      groupComposite: link(QUAD_VERTEX, GROUP, true),
    };
    gl.enableVertexAttribArray(0);
    this.positionBuffer = gl.createBuffer();
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const mesh of this.meshes) {
      mesh.uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
      mesh.indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    }
    // The destination copy that blend modes read, isolated groups' layers and their stencil, sized with the canvas.
    this.destination = this.targetTexture();
    this.depthStencil = gl.createRenderbuffer();
    this.layers = [];
    this.targetWidth = 0;
    this.targetHeight = 0;
    this.isolation = true;
  }

  /** A texture to render into or copy pixels to, sampled pixel for pixel. */
  targetTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** Sizes the destination copy, the layers and their stencil to [w] × [h]. */
  resizeTargets(w, h) {
    const gl = this.gl;
    this.targetWidth = w;
    this.targetHeight = h;
    const size = (texture) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    };
    size(this.destination);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthStencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
    for (const layer of this.layers) {
      size(layer.texture);
      layer.used = null;
    }
  }

  /** The layer at nesting [depth], created on first use; null when the context cannot render into textures. */
  layer(depth) {
    const gl = this.gl;
    if (!this.isolation) return null;
    while (this.layers.length <= depth) {
      const texture = this.targetTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.targetWidth, this.targetHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.depthStencil);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!complete) {
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(texture);
        this.isolation = false;
        return null;
      }
      // used: the pixels drawn since the layer was last cleared, to clear before its next group.
      this.layers.push({ texture, framebuffer, used: null });
    }
    return this.layers[depth];
  }

  async loadTextures() {
    const gl = this.gl;
    const rt = this.rt;
    const out = rt.p2l_alloc(16);
    this.textures = [];
    // Uploaded premultiplied, so bilinear sampling mixes premultiplied texels, and without color management
    // (an ImageBitmap carries both itself; the store flags cover browsers that read them).
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    for (let i = 0; i < rt.p2l_texture_count(this.rig); i++) {
      const pointer = rt.p2l_texture_png(this.rig, i, out, out + 8, out + 12);
      const length = new Uint32Array(rt.memory.buffer, out, 1)[0];
      const png = new Uint8Array(rt.memory.buffer, pointer, length).slice();
      const image = await createImageBitmap(new Blob([png], { type: "image/png" }), { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.push(texture);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    rt.p2l_dealloc(out, 16);
  }

  /** Plays a clip by id, cross-fading; null stops. */
  play(id) {
    this.rt.p2l_play(this.rig, id == null ? -1 : this.clips.indexOf(id));
  }

  /** Fades an expression in by id, the last one out; null fades it out to none. */
  expression(id) {
    this.rt.p2l_expression(this.rig, id == null ? -1 : this.expressions.indexOf(id));
  }

  /** Turns advanced mode's [features] on (0 is the Cubism-equivalent rig); returns those now on. */
  setAdvanced(features) {
    return this.rt.p2l_set_advanced(this.rig, features);
  }

  /** The rig's canvas point under a point of the page, as the canvas element draws it. */
  toRig(clientX, clientY) {
    const { scale, left, top, rect } = this.layout();
    return [(clientX - rect.left - left) / scale, (clientY - rect.top - top) / scale];
  }

  /** The hit area (e.g. "HitAreaHead") under a point of the page, or null. */
  hitTest(clientX, clientY) {
    const [x, y] = this.toRig(clientX, clientY);
    const i = this.rt.p2l_hit_test(this.rig, x, y);
    return i < 0 ? null : this.hitAreas[i];
  }

  /** Where to look, each axis -1..1 (x right, y up). */
  lookAt(x, y) {
    this.rt.p2l_look_at(this.rig, x, y);
  }

  /** Mouth opening 0..1; switches lip sync on. */
  lipSync(level) {
    this.rt.p2l_behaviors(this.rig, BLINK | BREATH | LOOK | LIP_SYNC);
    this.rt.p2l_lip_sync(this.rig, level);
  }

  /** Sets a parameter by id under clips and behaviors. */
  setParameter(id, value) {
    const i = this.parameters.indexOf(id);
    if (i >= 0) this.rt.p2l_set_parameter(this.rig, i, value);
  }

  start() {
    let last = performance.now();
    const frame = (now) => {
      this.update(Math.min((now - last) / 1000, 0.1));
      last = now;
      this.draw();
      this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
  }

  stop() {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = 0;
  }

  update(dt) {
    this.rt.p2l_update(this.rig, dt);
  }

  draw() {
    const gl = this.gl;
    const rt = this.rt;
    const canvas = this.canvas;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * ratio), h = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (w === 0 || h === 0) return;
    if (this.targetWidth !== w || this.targetHeight !== h) this.resizeTargets(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    // Fit the rig's canvas into the element, y down, then zoom and pan it.
    const fit = Math.min(w / this.width, h / this.height) * this.view.zoom;
    const sx = (2 * fit) / w, sy = (-2 * fit) / h;
    const px = (2 * this.view.x * ratio) / w, py = (-2 * this.view.y * ratio) / h;
    this.transform = [sx, sy, -this.width * sx / 2 + px, -this.height * sy / 2 + py];
    for (const p of Object.values(this.programs)) {
      gl.useProgram(p.program);
      if (p.loc.view) gl.uniform4f(p.loc.view, ...this.transform);
      if (p.loc.targetSize) gl.uniform2f(p.loc.targetSize, w, h);
      if (p.loc.layerSize) gl.uniform2f(p.loc.layerSize, w, h);
    }
    this.current = null;
    // Clockwise faces in canvas coordinates are counter-clockwise once y points up.
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.enable(gl.SCISSOR_TEST);

    const count = rt.p2l_render_commands(this.rig, this.commandsPointer, this.commandCapacity);
    const commands = new Int32Array(rt.memory.buffer, this.commandsPointer, Math.min(count, this.commandCapacity)).slice();
    // The targets being drawn into: the canvas, then each open group's layer.
    const stack = [{ framebuffer: null, used: null }];
    for (const command of commands) {
      const top = stack[stack.length - 1];
      if (command >= 0) {
        this.drawCommand(command, top);
      } else if (command <= -2) {
        const layer = this.layer(stack.length - 1);
        // Without layers the group's meshes draw where they are.
        if (!layer) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, top.framebuffer);
          stack.push({ pass: true, framebuffer: top.framebuffer, used: top.used });
          continue;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        if (layer.used) {
          this.scissor(layer.used);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        layer.used = null;
        layer.part = -2 - command;
        stack.push(layer);
      } else if (stack.length > 1) {
        const layer = stack.pop();
        const parent = stack[stack.length - 1];
        if (layer.pass) { parent.used = layer.used; continue; }
        gl.bindFramebuffer(gl.FRAMEBUFFER, parent.framebuffer);
        this.compositeGroup(layer, parent);
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
  }

  /** Uses [name]'s program. */
  use(name) {
    const p = this.programs[name];
    if (this.current !== p) {
      this.gl.useProgram(p.program);
      this.current = p;
    }
    return p.loc;
  }

  /** Limits drawing to [r] = [x0, y0, x1, y1] in framebuffer pixels (y up). */
  scissor(r) {
    this.gl.scissor(r[0], r[1], r[2] - r[0], r[3] - r[1]);
  }

  /** The framebuffer pixels mesh [m] can cover as [x0, y0, x1, y1], or null when none. */
  meshRect(m) {
    const v = this.meshVertices(m);
    const [sx, sy, ox, oy] = this.transform;
    const w = this.targetWidth, h = this.targetHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < v.length; i += 2) {
      const x = v[i], y = v[i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!(x0 <= x1 && y0 <= y1)) return v.length > 0 && v.some((c) => !Number.isFinite(c)) ? [0, 0, w, h] : null;
    // Canvas pixels to framebuffer pixels (y up), a pixel wider each way for rounding.
    const fx = (x) => ((x * sx + ox + 1) / 2) * w, fy = (y) => ((y * sy + oy + 1) / 2) * h;
    const ax = fx(x0), bx = fx(x1), ay = fy(y0), by = fy(y1);
    return this.clip([Math.floor(Math.min(ax, bx)) - 1, Math.floor(Math.min(ay, by)) - 1, Math.ceil(Math.max(ax, bx)) + 1, Math.ceil(Math.max(ay, by)) + 1]);
  }

  /** [r] within the framebuffer, or null when it is empty there. */
  clip(r) {
    const x0 = Math.max(0, r[0]), y0 = Math.max(0, r[1]);
    const x1 = Math.min(this.targetWidth, r[2]), y1 = Math.min(this.targetHeight, r[3]);
    return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : null;
  }

  /** Adds [r] to the pixels [target] holds. */
  touch(target, r) {
    const u = target.used;
    target.used = u ? [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])] : r.slice();
  }

  /** Copies the pixels [r] of the bound framebuffer into the destination texture blend modes read. */
  copyDestination(r) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.destination);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, r[0], r[1], r[0], r[1], r[2] - r[0], r[3] - r[1]);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Blend functions for the pairs that need no destination read: normal over, Cubism's add and multiply. */
  blendFunction(mode) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    if (mode === 1) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    else if (mode === 2) gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Writes 1 into the stencil of the bound framebuffer within [r] where [masks] cover, then tests against it:
   * drawing goes where it is 1, or where it is not when [inverted].
   */
  stencilMasks(masks, inverted, r) {
    const gl = this.gl;
    this.scissor(r);
    gl.enable(gl.STENCIL_TEST);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.colorMask(false, false, false, false);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    this.use("mesh");
    for (const mask of masks) this.drawMesh(mask, 1, 0.5);
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(inverted ? gl.NOTEQUAL : gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  }

  /** Draws mesh [m] onto [target], the bound framebuffer. */
  drawCommand(m, target) {
    const gl = this.gl;
    const rt = this.rt;
    const mesh = this.meshes[m];
    const opacity = rt.p2l_mesh_opacity(this.rig, m);
    if (!(opacity > 0) || !mesh || !this.textures[mesh.texture] || mesh.vertices === 0) return;
    const r = this.meshRect(m);
    if (!r) return;
    if (mesh.masks.length > 0) this.stencilMasks(mesh.masks, mesh.invertMask, r);
    this.scissor(r);
    let loc;
    if (mesh.fixed) {
      loc = this.use("mesh");
      this.blendFunction(mesh.blend);
    } else {
      this.copyDestination(r);
      loc = this.use("meshComposite");
      gl.disable(gl.BLEND);
      gl.uniform1i(loc.colorBlend, mesh.blend);
      gl.uniform1i(loc.alphaBlend, mesh.alphaBlend);
    }
    if (mesh.culling) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    rt.p2l_mesh_colors(this.rig, m, this.colors, this.colors + 12);
    const colors = new Float32Array(rt.memory.buffer, this.colors, 6);
    gl.uniform3f(loc.multiply, colors[0], colors[1], colors[2]);
    gl.uniform3f(loc.screen, colors[3], colors[4], colors[5]);
    this.drawMesh(m, Math.min(opacity, 1), 0);
    if (mesh.masks.length > 0) gl.disable(gl.STENCIL_TEST);
    this.touch(target, r);
  }

  /** Composites [layer], an isolated group's drawing, onto [parent], the bound framebuffer. */
  compositeGroup(layer, parent) {
    const gl = this.gl;
    const rt = this.rt;
    const r = layer.used;
    const group = this.groups[layer.part];
    if (!r || !group) return;
    const c = this.colors;
    if (!rt.p2l_part_composite(this.rig, layer.part, c, c + 4, c + 16)) return;
    const values = new Float32Array(rt.memory.buffer, c, 7);
    const opacity = Math.min(values[0], 1);
    if (!(opacity > 0)) return;
    gl.disable(gl.CULL_FACE);
    if (group.masks.length > 0) this.stencilMasks(group.masks, group.invertMask, r);
    this.scissor(r);
    let loc;
    if (group.fixed) {
      loc = this.use("group");
      this.blendFunction(group.blend);
    } else {
      this.copyDestination(r);
      loc = this.use("groupComposite");
      gl.disable(gl.BLEND);
      gl.uniform1i(loc.colorBlend, group.blend);
      gl.uniform1i(loc.alphaBlend, group.alphaBlend);
    }
    gl.uniform1f(loc.opacity, opacity);
    gl.uniform3f(loc.multiply, values[1], values[2], values[3]);
    gl.uniform3f(loc.screen, values[4], values[5], values[6]);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    gl.disableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (group.masks.length > 0) gl.disable(gl.STENCIL_TEST);
    this.touch(parent, r);
  }

  drawMesh(m, opacity, maskThreshold) {
    const gl = this.gl;
    const mesh = this.meshes[m];
    const texture = mesh && this.textures[mesh.texture];
    if (!texture || mesh.vertices === 0) return;
    const loc = this.current.loc;
    const pointer = this.rt.p2l_mesh_vertices(this.rig, m);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.rt.memory.buffer, pointer, mesh.vertices * 2), gl.STREAM_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1f(loc.opacity, opacity);
    gl.uniform1f(loc.maskThreshold, maskThreshold);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, this.indexType, 0);
  }
}
