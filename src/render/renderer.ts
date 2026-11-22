import { ClaySim, RINGS } from '../sim/claySim';

// ---------------------------------------------------------------------------
// WebGL2 车床渲染器: 把轴对称剖面旋转成 ~2 万顶点的网格。
// 每帧仅在 CPU 侧重建顶点(位置+法线, ~500KB), 一次 bufferSubData 上传,
// 从输入到上屏控制在一帧内(<20ms)。
// ---------------------------------------------------------------------------

const RV = 160;   // 视觉环数(外壁)
const SEG = 96;   // 周向分段
const RIV = 64;   // 内壁环数
// 动态顶点数: 外 160*96 + 内 64*96 + 口沿 2*96 = 15360 + 6144 + 192 = 21696 (≈2 万)

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uSpin;
out vec3 vN;
out vec3 vW;
void main() {
  float c = cos(uSpin), s = sin(uSpin);
  vec3 p = vec3(aPos.x * c - aPos.z * s, aPos.y, aPos.x * s + aPos.z * c);
  vN = vec3(aNormal.x * c - aNormal.z * s, aNormal.y, aNormal.x * s + aNormal.z * c);
  vW = p;
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
uniform vec3 uColor;
uniform vec3 uEye;
uniform float uWet;    // 水量 → 镜面高光
uniform float uCrack;  // 拧裂程度 → 发暗发涩
uniform float uSpinLight;
out vec4 outColor;
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(0.5, 0.8, 0.6));
  vec3 V = normalize(uEye - vW);
  float diff = max(dot(N, L), 0.0);
  float hemi = 0.5 + 0.5 * N.y;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 60.0) * (0.15 + 0.85 * uWet);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.25 * uWet;
  vec3 col = uColor * (0.32 * hemi + 0.75 * diff);
  col = mix(col, col * 0.45, uCrack);          // 裂纹处发暗
  col += vec3(spec + fres) * mix(1.0, 0.2, uCrack);
  outColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
  return sh;
}

// --- 最小 mat4 (列主序) ---
function perspective(fovY: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovY / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = 2 * far * near / (near - far);
  return m;
}
function lookAt(eye: number[], center: number[], up: number[]) {
  const z = norm3([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot3(x, eye); m[13] = -dot3(y, eye); m[14] = -dot3(z, eye); m[15] = 1;
  return m;
}
function norm3(v: number[]) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a: number[], b: number[]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

const VERT_COUNT = RV * SEG + RIV * SEG + 2 * SEG;

export class LatheRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private verts = new Float32Array(VERT_COUNT * 6);
  private indexCount = 0;
  private uProj: WebGLUniformLocation; private uView: WebGLUniformLocation;
  private uSpin: WebGLUniformLocation; private uColor: WebGLUniformLocation;
  private uEye: WebGLUniformLocation; private uWet: WebGLUniformLocation;
  private uCrack: WebGLUniformLocation;
  // 静态轮盘
  private discVao: WebGLVertexArrayObject;
  private discCount = 0;
  private camEye = [0, 120, 420];
  private proj = ident4();
  private view = ident4();
  spin = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('需要 WebGL2 支持');
    this.gl = gl;
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog) || 'link');
    gl.useProgram(this.prog);
    const U = (n: string) => gl.getUniformLocation(this.prog, n)!;
    this.uProj = U('uProj'); this.uView = U('uView'); this.uSpin = U('uSpin');
    this.uColor = U('uColor'); this.uEye = U('uEye'); this.uWet = U('uWet'); this.uCrack = U('uCrack');

    // 动态泥坯网格
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.buildIndices(), gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    // 静态轮盘(转盘+水盆沿)
    this.discVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.discVao);
    const disc = this.buildDisc();
    this.discCount = disc.length / 6;
    const dvbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, dvbo);
    gl.bufferData(gl.ARRAY_BUFFER, disc, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    // 不剔除背面: 内外壁法线各自正确, 双面绘制避免绕序问题
  }

  private buildIndices(): Uint32Array {
    const idx: number[] = [];
    const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    };
    // 外壁
    for (let j = 0; j < RV - 1; j++) for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG;
      quad(j * SEG + k, j * SEG + k2, (j + 1) * SEG + k, (j + 1) * SEG + k2, false);
    }
    // 内壁(法线朝内, 绕序翻转)
    const io = RV * SEG;
    for (let j = 0; j < RIV - 1; j++) for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG;
      quad(io + j * SEG + k, io + j * SEG + k2, io + (j + 1) * SEG + k, io + (j + 1) * SEG + k2, true);
    }
    // 口沿: 外顶环 ↔ 内顶环
    const ro = (RV - 1) * SEG, ri = io + (RIV - 1) * SEG;
    for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG;
      idx.push(ro + k, ro + k2, ri + k, ro + k2, ri + k2, ri + k);
    }
    this.indexCount = idx.length;
    return new Uint32Array(idx);
  }

  private buildDisc(): Float32Array {
    // 转盘: y∈[-8,0] 半径120 的圆台 + 接水盆沿
    const v: number[] = [];
    const S = 64;
    const ring = (y: number, r: number, ny: number, nr: number) => {
      const out: number[] = [];
      for (let k = 0; k < S; k++) {
        const a = k / S * Math.PI * 2;
        out.push(r * Math.cos(a), y, r * Math.sin(a), nr * Math.cos(a), ny, nr * Math.sin(a));
      }
      return out;
    };
    const strip = (r0: number[], r1: number[], flip: boolean) => {
      for (let k = 0; k < S; k++) {
        const k2 = (k + 1) % S;
        const a = r0.slice(k * 6, k * 6 + 6), b = r0.slice(k2 * 6, k2 * 6 + 6);
        const c = r1.slice(k * 6, k * 6 + 6), d = r1.slice(k2 * 6, k2 * 6 + 6);
        if (flip) v.push(...a, ...c, ...b, ...b, ...c, ...d);
        else v.push(...a, ...b, ...c, ...b, ...d, ...c);
      }
    };
    const top = ring(0, 120, 1, 0);
    const bot = ring(-8, 120, 1, 0);
    const botEdge = ring(-8, 120, 0, 1);
    const topEdge = ring(0, 120, 0, 1);
    const panIn = ring(-14, 150, 1, -0.3);
    const panOut = ring(-14, 165, 1, 0);
    strip(ring(0.01, 0.5, 1, 0), top, false);          // 盘面
    strip(topEdge, botEdge, true);                      // 盘侧
    strip(bot, ring(-8.01, 0.5, 1, 0), true);           // 盘底
    strip(top, panIn, false);                           // 盆沿内斜面
    strip(panIn, panOut, false);                        // 盆沿顶
    return new Float32Array(v);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth * dpr | 0, h = this.canvas.clientHeight * dpr | 0;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  /** 从模拟剖面重建顶点数组 */
  private buildVertices(sim: ClaySim) {
    const H = Math.max(sim.H, 1);
    // 剖面采样: 给定高度取外半径/内半径(线性插值)
    const prof = (yy: number): [number, number] => {
      const yc = Math.min(Math.max(yy, 0), H - 1e-6);
      let j = 0;
      while (j < RINGS - 2 && sim.y[j + 1] < yc) j++;
      const f = (yc - sim.y[j]) / Math.max(sim.h[j], 1e-9);
      const r0 = sim.r[j], r1 = sim.r[Math.min(j + 1, RINGS - 1)];
      const i0 = sim.innerR(j), i1 = sim.innerR(Math.min(j + 1, RINGS - 1));
      return [r0 + (r1 - r0) * Math.min(Math.max(f, 0), 1), i0 + (i1 - i0) * Math.min(Math.max(f, 0), 1)];
    };
    // 坯底(实心段)顶面高度
    let yFloor = 0;
    for (let i = 0; i < RINGS; i++) { if (sim.innerR(i) > 0.6) { yFloor = sim.y[i]; break; } }
    const wob = (yy: number): [number, number] => {
      const w = sim.wobble * Math.pow(Math.min(yy / H, 1), 1.3);
      return [w * Math.cos(sim.wobbleDir), w * Math.sin(sim.wobbleDir)];
    };
    const vt = this.verts;
    let o = 0;
    // 外壁
    for (let j = 0; j < RV; j++) {
      const y = H * j / (RV - 1);
      const [r] = prof(y);
      const [rA] = prof(Math.max(y - 2, 0));
      const [rB] = prof(Math.min(y + 2, H));
      const slope = (rB - rA) / 4; // dr/dy
      const nl = Math.hypot(1, slope);
      const ny = -slope / nl, nr = 1 / nl;
      const [ox, oz] = wob(y);
      for (let k = 0; k < SEG; k++) {
        const a = k / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        vt[o++] = r * ca + ox; vt[o++] = y; vt[o++] = r * sa + oz;
        vt[o++] = nr * ca; vt[o++] = ny; vt[o++] = nr * sa;
      }
    }
    // 内壁(从坯底到口沿)
    for (let j = 0; j < RIV; j++) {
      const y = yFloor + (H - yFloor) * j / (RIV - 1);
      const [, ir] = prof(y);
      const [, iA] = prof(Math.max(y - 2, yFloor));
      const [, iB] = prof(Math.min(y + 2, H));
      const slope = (iB - iA) / 4;
      const nl = Math.hypot(1, slope);
      const ny = slope / nl, nr = -1 / nl; // 法线朝轴心
      const [ox, oz] = wob(y);
      const rr = Math.max(ir, 0.4);
      for (let k = 0; k < SEG; k++) {
        const a = k / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        vt[o++] = rr * ca + ox; vt[o++] = y; vt[o++] = rr * sa + oz;
        vt[o++] = nr * ca; vt[o++] = ny; vt[o++] = nr * sa;
      }
    }
    // 口沿(外顶环 → 内顶环)
    const [rTop, iTop] = prof(H);
    const [oxT, ozT] = wob(H);
    for (let k = 0; k < SEG; k++) {
      const a = k / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      vt[o++] = rTop * ca + oxT; vt[o++] = H; vt[o++] = rTop * sa + ozT;
      vt[o++] = 0; vt[o++] = 1; vt[o++] = 0;
    }
    for (let k = 0; k < SEG; k++) {
      const a = k / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      vt[o++] = Math.max(iTop, 0.4) * ca + oxT; vt[o++] = H; vt[o++] = Math.max(iTop, 0.4) * sa + ozT;
      vt[o++] = 0; vt[o++] = 1; vt[o++] = 0;
    }
  }

  /** 世界坐标 → 画布像素坐标 */
  project(x: number, y: number, z: number): { x: number; y: number } {
    const m = mul4(this.proj, this.view);
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    return {
      x: (cx / cw * 0.5 + 0.5) * this.canvas.width,
      y: (0.5 - cy / cw * 0.5) * this.canvas.height,
    };
  }

  render(sim: ClaySim, dt: number) {
    const gl = this.gl;
    this.resize();
    this.spin += sim.rpm * Math.PI / 30 * dt;
    this.buildVertices(sim);

    // 相机: 跟随坯高平滑调整
    const H = sim.H;
    const dist = Math.max(H * 1.25 + 150, 260);
    const target = [dist * 0.32, H * 0.5 + dist * 0.42, dist * 0.88];
    for (let i = 0; i < 3; i++) this.camEye[i] += (target[i] - this.camEye[i]) * Math.min(1, dt * 4);
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    this.proj = perspective(0.62, aspect, 1, 4000);
    this.view = lookAt(this.camEye, [0, H * 0.45, 0], [0, 1, 0]);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.13, 0.13, 0.15, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uProj, false, this.proj);
    gl.uniformMatrix4fv(this.uView, false, this.view);
    gl.uniform3fv(this.uEye, this.camEye);
    gl.uniform1f(this.uWet, sim.water);
    gl.uniform1f(this.uCrack, sim.crack);

    // 轮盘(深灰, 随盘转)
    gl.uniform1f(this.uSpin, this.spin);
    gl.uniform3f(this.uColor, 0.22, 0.22, 0.24);
    gl.bindVertexArray(this.discVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.discCount);

    // 泥坯
    gl.uniform3fv(this.uColor, sim.clay.color);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.verts);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
}

function ident4(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
