// Colour grading: 3D LUT looks (built in, or any .cube file) plus exposure, contrast, saturation,
// temperature, tint and vignette. Runs on the GPU with WebGL2, so it's live in the preview and the same
// pixels go into the export. The LUT maths and .cube parsing are pure functions (tested in Node).

export const LUT_SIZE = 33;

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = (r, g, b, k) => { const l = lum(r, g, b); return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k]; };
const scurve = (x, k) => x + k * (x - 0.5) * (1 - Math.abs(2 * x - 1)); // gentle S, keeps 0 and 1

/** Built-in looks: (r, g, b) in 0..1 → [r, g, b]. */
export const LOOKS = {
  cinematic: { name: 'Cinematic', fn: (r, g, b) => {
    const l = lum(r, g, b), t = l - 0.5; // shadows toward teal, highlights toward orange
    [r, g, b] = [r + t * 0.16, g + t * 0.02, b - t * 0.18];
    [r, g, b] = sat(r, g, b, 1.08);
    return [scurve(r, 0.35), scurve(g, 0.35), scurve(b, 0.35)];
  } },
  warm: { name: 'Warm', fn: (r, g, b) => [r * 1.06 + 0.025, g * 1.01 + 0.01, b * 0.9] },
  golden: { name: 'Golden Hour', fn: (r, g, b) => {
    const l = lum(r, g, b);
    [r, g, b] = [r + 0.14 * l, g + 0.07 * l, b - 0.1 * l];
    return sat(scurve(r, 0.2), scurve(g, 0.2), scurve(b, 0.2), 1.12);
  } },
  moody: { name: 'Moody', fn: (r, g, b) => {
    [r, g, b] = sat(r, g, b, 0.72);
    const lift = (x, s) => scurve(x, 0.45) * 0.92 + s;
    return [lift(r, 0.01), lift(g, 0.02), lift(b, 0.05)];
  } },
  vintage: { name: 'Vintage', fn: (r, g, b) => {
    [r, g, b] = sat(r, g, b, 0.78);
    return [r * 0.86 + 0.1, g * 0.84 + 0.08, b * 0.76 + 0.06];
  } },
  coolfilm: { name: 'Cool Film', fn: (r, g, b) => {
    [r, g, b] = [r * 0.95, g * 0.99 + 0.01, b * 1.04 + 0.03];
    return [scurve(r, 0.2) * 0.94 + 0.03, scurve(g, 0.2) * 0.94 + 0.03, scurve(b, 0.2) * 0.94 + 0.03];
  } },
  vivid: { name: 'Vivid Pop', fn: (r, g, b) => { [r, g, b] = sat(r, g, b, 1.38); return [scurve(r, 0.25), scurve(g, 0.25), scurve(b, 0.25)]; } },
  bw: { name: 'B&W', fn: (r, g, b) => { const l = scurve(lum(r, g, b), 0.4); return [l, l, l]; } },
  tealorange: { name: 'Teal & Orange', fn: (r, g, b) => {
    const l = lum(r, g, b), t = l - 0.5; // stronger split than Cinematic: warm skin, teal shadows
    [r, g, b] = [r + t * 0.28, g + t * 0.02, b - t * 0.3];
    [r, g, b] = sat(r, g, b, 1.15);
    return [scurve(r, 0.4), scurve(g, 0.4), scurve(b, 0.4)];
  } },
  bollywood: { name: 'Bollywood', fn: (r, g, b) => {
    [r, g, b] = [r * 1.08 + 0.03, g * 1.02 + 0.015, b * 0.92];
    return sat(scurve(r, 0.3), scurve(g, 0.3), scurve(b, 0.3), 1.3);
  } },
  noir: { name: 'Film Noir', fn: (r, g, b) => { const l = scurve(scurve(lum(r, g, b), 0.6), 0.4); return [l, l, l]; } },
  wedding: { name: 'Wedding', fn: (r, g, b) => {
    [r, g, b] = sat(r, g, b, 0.85);
    return [r * 0.88 + 0.1, g * 0.88 + 0.08, b * 0.86 + 0.07];
  } },
  travel: { name: 'Travel Vibrant', fn: (r, g, b) => {
    [r, g, b] = [r, g * 1.04, b * 1.06 + 0.01];
    [r, g, b] = sat(r, g, b, 1.35);
    return [scurve(r, 0.2), scurve(g, 0.2), scurve(b, 0.2)];
  } },
  neon: { name: 'Night Neon', fn: (r, g, b) => {
    const s = 1 - lum(r, g, b); // push shadows toward blue-violet
    [r, g, b] = [r + s * 0.06, g - s * 0.02, b + s * 0.14];
    return sat(scurve(r, 0.35), scurve(g, 0.35), scurve(b, 0.35), 1.25);
  } },
  matte: { name: 'Matte Fade', fn: (r, g, b) => {
    [r, g, b] = sat(r, g, b, 0.9);
    return [r * 0.86 + 0.09, g * 0.86 + 0.09, b * 0.86 + 0.1];
  } },
  sepia: { name: 'Sepia', fn: (r, g, b) => {
    const l = scurve(lum(r, g, b), 0.2);
    return [l * 1.07 + 0.04, l * 0.9 + 0.03, l * 0.7 + 0.02];
  } },
  cyberpunk: { name: 'Cyberpunk', fn: (r, g, b) => {
    const t = lum(r, g, b) - 0.5; // magenta highlights, cyan-blue shadows
    [r, g, b] = [r + 0.06 + t * 0.1, g * 0.9, b + 0.08 - t * 0.12];
    return sat(scurve(r, 0.35), scurve(g, 0.35), scurve(b, 0.35), 1.3);
  } },
  coldmoody: { name: 'Cold Moody', fn: (r, g, b) => {
    [r, g, b] = sat(r, g, b, 0.55);
    [r, g, b] = [r * 0.94, g * 0.98, b * 1.05 + 0.02];
    return [scurve(r, 0.45) * 0.9 + 0.02, scurve(g, 0.45) * 0.9 + 0.03, scurve(b, 0.45) * 0.9 + 0.05];
  } },
};

/** A size³ RGB LUT (red changes fastest, like .cube files) as Uint8Array. */
export function buildLut(fn, size = LUT_SIZE) {
  const out = new Uint8Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const c = fn(r / (size - 1), g / (size - 1), b / (size - 1));
    out[i++] = Math.round(clamp01(c[0]) * 255); out[i++] = Math.round(clamp01(c[1]) * 255); out[i++] = Math.round(clamp01(c[2]) * 255);
  }
  return { size, data: out };
}

/** Parse an Adobe/Resolve .cube 3D LUT. Returns { size, data: Uint8Array, title }. Throws on bad files. */
export function parseCube(text) {
  let size = 0, title = '', min = [0, 0, 0], max = [1, 1, 1];
  const vals = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
    if (key === 'LUT_3D_SIZE') { size = +rest[0]; continue; }
    if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs aren’t supported; use a 3D .cube file.');
    if (key === 'DOMAIN_MIN') { min = rest.map(Number); continue; }
    if (key === 'DOMAIN_MAX') { max = rest.map(Number); continue; }
    if (/^[-+.\d]/.test(key)) { const v = [key, ...rest].slice(0, 3).map(Number); if (v.length === 3 && v.every(Number.isFinite)) vals.push(v); }
  }
  if (!size || size < 2 || size > 128) throw new Error('This .cube file has no valid LUT_3D_SIZE.');
  if (vals.length !== size ** 3) throw new Error(`This .cube file should have ${size ** 3} colour rows but has ${vals.length}.`);
  const data = new Uint8Array(size ** 3 * 3);
  vals.forEach((v, i) => { for (let k = 0; k < 3; k++) data[i * 3 + k] = Math.round(clamp01((v[k] - min[k]) / ((max[k] - min[k]) || 1)) * 255); });
  return { size, data, title };
}

export const DEFAULT_GRADE = { look: 'none', mix: 1, exp: 0, con: 0, sat: 0, temp: 0, tint: 0, vig: 0 };
export const isGraded = g => !!g && (g.look !== 'none' || ['exp', 'con', 'sat', 'temp', 'tint', 'vig'].some(k => g[k]));

const VS = `#version 300 es
in vec2 p; out vec2 v;
void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler2D img; uniform sampler3D lut;
uniform float lutSize, mixAmt, exposure, contrast, saturation, temperature, tint, vignette, hasLut;
in vec2 v; out vec4 o;
void main() {
  vec3 c = texture(img, v).rgb;
  c *= exp2(exposure);
  c += vec3(temperature * 0.08, -tint * 0.05, -temperature * 0.08);
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.0 + saturation);
  c = clamp(c, 0.0, 1.0);
  if (hasLut > 0.5) {
    vec3 g = texture(lut, c * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize).rgb;
    c = mix(c, g, mixAmt);
  }
  float d = distance(v, vec2(0.5));
  c *= 1.0 - vignette * smoothstep(0.25, 0.8, d);
  o = vec4(c, 1.0);
}`;

/** GPU grader. render(source, w, h) returns a canvas with the graded frame (or null if WebGL2 is missing). */
export class Grader {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = this.prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(['img', 'lut', 'lutSize', 'mixAmt', 'exposure', 'contrast', 'saturation', 'temperature', 'tint', 'vignette', 'hasLut'].map(n => [n, gl.getUniformLocation(prog, n)]));
    this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    this.lutTex = gl.createTexture();
    gl.uniform1i(this.u.img, 0); gl.uniform1i(this.u.lut, 1);
    this.lutKey = null;
  }
  get ok() { return !!this.gl; }
  setLut(lut, key) {
    const gl = this.gl;
    if (!gl || key === this.lutKey) return;
    this.lutKey = key; this.lutSize = lut ? lut.size : 0;
    if (!lut) return;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut.data);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.LINEAR);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
  }
  render(source, w, h, g) {
    const gl = this.gl;
    if (!gl) return null;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch { return null; }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const u = this.u;
    gl.uniform1f(u.hasLut, this.lutSize ? 1 : 0); gl.uniform1f(u.lutSize, this.lutSize || 1);
    gl.uniform1f(u.mixAmt, g.mix ?? 1); gl.uniform1f(u.exposure, g.exp || 0); gl.uniform1f(u.contrast, g.con || 0);
    gl.uniform1f(u.saturation, g.sat || 0); gl.uniform1f(u.temperature, g.temp || 0); gl.uniform1f(u.tint, g.tint || 0); gl.uniform1f(u.vignette, g.vig || 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}
