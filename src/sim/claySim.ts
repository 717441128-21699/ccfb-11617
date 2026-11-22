import type { ClaySpec } from './clays';

// ---------------------------------------------------------------------------
// 泥坯模拟: 轴对称拉格朗日网格。
// 泥坯被切成 RINGS 个材料圆环, 每环体积守恒(拉坯/修坯只重新分配, 不凭空增减),
// 由 v(体积)、r(外半径)、h(环高) 推出壁厚 t 与内半径。
// 物理: 转盘转速 + 手的压力/位置决定泥的流动; 未定中心时偏摆会被放大;
// 缺水发涩会被拧裂; 壁厚低于临界或口沿外撇过多时按自重+离心力判塌坯。
// ---------------------------------------------------------------------------

export const RINGS = 160;
const FLOOR_FRAC = 0.12;      // 底部实心部分(坯底)
const T_MIN = 1.6;            // mm, 壁厚绝对临界值
const RHO = 0.0022;           // g/mm^3 湿泥密度
const GRAV_C = 0.9;           // 自重应力系数(游戏单位)
const CENT_C = 1.0e-4;        // 离心应力系数
const FLARE_SOFT = 0.7;       // 口沿外撇开始受罚的斜率 dr/dy
const FLARE_LIMIT = 2.1;      // 口沿外撇直接判塌的斜率
const BAND_W = 14;            // 手的作用带宽 mm

export interface HandInput {
  active: boolean;   // 手是否接触泥坯
  y: number;         // 手的高度 mm
  pressure: number;  // 0..1 向轴心的压力
  sponge: boolean;   // 是否正在补水
}

export const IDLE_HAND: HandInput = { active: false, y: 0, pressure: 0, sponge: false };

export class ClaySim {
  readonly clay: ClaySpec;
  rpm = 120;

  r = new Float32Array(RINGS);   // 外半径 mm
  h = new Float32Array(RINGS);   // 环高 mm
  v = new Float32Array(RINGS);   // 环体积 mm^3 (材料守恒量)
  y = new Float32Array(RINGS);   // 环底高度 mm
  H = 0;                          // 总高 mm

  wobble = 6;        // 口沿偏摆幅度 mm
  wobbleDir = 0;     // 偏摆相位(随转盘进动)
  water = 0.8;       // 润滑水量 0..1
  crack = 0;         // 拧裂累积 0..1
  collapsed = false;
  cracked = false;
  collapseReason = '';
  private prevHandY = 0;

  constructor(clay: ClaySpec) {
    this.clay = clay;
    this.reset();
  }

  reset() {
    const H0 = 55, R0 = 62, T0 = 18;
    const hi = H0 / RINGS;
    const floor = Math.floor(RINGS * FLOOR_FRAC);
    for (let i = 0; i < RINGS; i++) {
      this.h[i] = hi;
      this.r[i] = R0;
      this.v[i] = i < floor
        ? Math.PI * R0 * R0 * hi                       // 实心坯底
        : Math.PI * (R0 * R0 - (R0 - T0) * (R0 - T0)) * hi; // 厚壁筒
    }
    this.wobble = 6; this.wobbleDir = 0;
    this.water = 0.8; this.crack = 0;
    this.collapsed = false; this.cracked = false; this.collapseReason = '';
    this.updateHeights();
  }

  updateHeights() {
    let acc = 0;
    for (let i = 0; i < RINGS; i++) { this.y[i] = acc; acc += this.h[i]; }
    this.H = acc;
  }

  floorRings() { return Math.floor(RINGS * FLOOR_FRAC); }

  innerR(i: number) {
    const inner2 = this.r[i] * this.r[i] - this.v[i] / (Math.PI * this.h[i]);
    return inner2 > 0 ? Math.sqrt(inner2) : 0;
  }
  thickness(i: number) { return this.r[i] - this.innerR(i); }

  /** 器身(不含坯底)按高度加权的平均壁厚 */
  avgWall(): number {
    let sw = 0, st = 0;
    for (let i = this.floorRings(); i < RINGS; i++) { sw += this.h[i]; st += this.thickness(i) * this.h[i]; }
    return sw > 0 ? st / sw : 0;
  }

  rimFlare(): number {
    const k = 8, top = RINGS - 1;
    const dy = Math.max(this.y[top] - this.y[top - k], 1e-6);
    return (this.r[top] - this.r[top - k]) / dy;
  }

  get failed() { return this.collapsed || this.cracked; }

  step(dt: number, input: HandInput) {
    dt = Math.min(dt, 0.05);
    const omega = this.rpm * Math.PI / 30;
    this.wobbleDir += omega * dt;

    // --- 水: 补水 / 摩擦消耗 / 缓慢蒸发 ---
    if (input.sponge) this.water = Math.min(1, this.water + 1.5 * dt);
    const touching = input.active && input.pressure > 0 && input.y > -10 && input.y < this.H + 25;
    if (touching) {
      this.water -= input.pressure * this.clay.waterUse * (0.4 + omega / 15) * dt * 0.05;
    }
    this.water -= 0.004 * dt;
    this.water = Math.max(0, Math.min(1, this.water));
    // 润滑系数: 水少则发涩
    const L = smoothstep(0.04, 0.45, this.water);

    if (touching && !this.failed) {
      const p = input.pressure;

      // --- 定中心: 在泥坯中下部施加稳定压力, 偏摆逐渐收敛; 泥越硬越慢 ---
      if (input.y < this.H * 0.6 && this.wobble > 0) {
        const rate = p * this.clay.plasticity * (0.4 + 0.6 * L) * (omega / 12) * (2.2 / this.clay.stiffness);
        this.wobble = Math.max(0, this.wobble - rate * dt);
      }

      // --- 挤压: 手所在带内的泥被压向轴心。体积守恒 → 局部壁变厚(鼓包) ---
      const dr = p * this.clay.plasticity * (0.25 + 0.75 * L) * 9 * dt;
      let wSum = 0;
      for (let i = this.floorRings(); i < RINGS; i++) {
        const cy = this.y[i] + this.h[i] * 0.5;
        const w = Math.exp(-(((cy - input.y) / BAND_W) ** 2));
        if (w > 0.01) {
          // 手不能把壁压穿: 外半径不会小于内半径+0.8mm
          this.r[i] = Math.max(8, this.innerR(i) + 0.8, this.r[i] - dr * w);
          wSum += w;
        }
      }

      // --- 泥的输运(半拉格朗日平流): 手上方的泥被手带着以速度 u 上行,
      //     手所在处速度有梯度 → 器壁在那里被拉长、拉薄。手不提, 泥不长。 ---
      if (wSum > 0) {
        const liftSpeed = Math.max(0, input.y - this.prevHandY) / dt; // mm/s
        const grip = p * (0.25 + 0.75 * L) * this.clay.plasticity;
        const uTop = liftSpeed * grip * 0.5; // 手上方泥的速度
        if (uTop > 0.001) {
          let vTotal0 = 0;
          for (let i = 0; i < RINGS; i++) vTotal0 += this.v[i];
          const cy = new Float64Array(RINGS);
          const u = new Float64Array(RINGS);
          for (let i = 0; i < RINGS; i++) {
            cy[i] = this.y[i] + this.h[i] * 0.5;
            u[i] = uTop * smoothstep(input.y - 10, input.y + 10, cy[i]);
          }
          // 平流: 从上游位置取样 线密度v/h 和 半径r (网格按 y 有序, 线性插值)
          const vOld = Float32Array.from(this.v);
          const hOld = Float32Array.from(this.h);
          const rOld = Float32Array.from(this.r);
          const yOld = Float32Array.from(this.y);
          const sample = (yy: number, arr: Float32Array) => {
            if (yy <= yOld[0]) return arr[0];
            let j = 0;
            while (j < RINGS - 2 && yOld[j + 1] < yy) j++;
            const f = (yy - yOld[j]) / Math.max(hOld[j], 1e-9);
            return arr[j] + (arr[Math.min(j + 1, RINGS - 1)] - arr[j]) * Math.min(Math.max(f, 0), 1);
          };
          for (let i = 0; i < RINGS; i++) {
            const srcY = cy[i] - u[i] * dt;
            const dl = sample(srcY, vOld) / Math.max(sample(srcY, hOld), 1e-9); // 旧线密度
            this.v[i] = dl * this.h[i]; // 先按旧环高还原, 下面拉伸时 v 守恒
            this.r[i] = sample(srcY, rOld);
          }
          // 拉伸: h 按速度梯度增长, v 守恒(环体积不变, 壁厚自然下降)
          for (let i = 0; i < RINGS; i++) {
            const du = (i + 1 < RINGS ? u[i + 1] - u[i] : 0) / Math.max(this.h[i], 1e-9);
            this.h[i] *= 1 + Math.max(0, du) * dt;
          }
          // 半拉格朗日重采样不完全守恒 → 按总体积归一(形状不变, 总量守恒)
          let vTotal1 = 0;
          for (let i = 0; i < RINGS; i++) vTotal1 += this.v[i];
          if (vTotal1 > 0) {
            const k = vTotal0 / vTotal1;
            for (let i = 0; i < RINGS; i++) this.v[i] *= k;
          }
          // 没定中心就往上拉: 偏摆随拉升量指数放大
          if (this.wobble > 0.8) {
            this.wobble *= Math.exp(2.0 * uTop * dt / Math.max(this.H, 20));
          }
          this.updateHeights();
        }
      }

      // --- 缺水发涩: 继续上手会被拧裂 ---
      if (this.water < 0.3 && p > 0.2) {
        this.crack += ((0.3 - this.water) / 0.3) * p * this.clay.crackSensitivity * (0.5 + omega / 12) * dt * 0.35;
        if (this.crack >= 1) { this.crack = 1; this.cracked = true; }
      }
    }
    this.prevHandY = input.y;

    // --- 表面张力式的平滑: 泥是连续体, 局部突变会被抹平 ---
    if (!this.failed) this.smooth(0.12, 0.06);

    // --- 高转速下湿泥被微微甩向外(口沿外撇的来源之一) ---
    if (!this.failed && omega > 4) {
      const grow = 2.0e-8 * omega * omega * this.clay.plasticity * (0.3 + 0.7 * L) * dt;
      for (let i = this.floorRings(); i < RINGS; i++) {
        const thinBoost = this.thickness(i) < 5 ? 2 : 1;
        this.r[i] += grow * this.r[i] * thinBoost;
      }
      // 偏摆的离心放大
      if (this.wobble > 1.5) this.wobble += this.wobble * omega * omega * 1.2e-6 * dt;
    }

    this.updateHeights();
    this.checkCollapse(omega);
  }

  private smooth(kh: number, kr: number) {
    const { h, r } = this;
    let ph = h[0], pr = r[0];
    for (let i = 1; i < RINGS - 1; i++) {
      const ch = h[i], cr = r[i];
      h[i] += kh * (ph + h[i + 1] - 2 * ch);
      r[i] += kr * (pr + r[i + 1] - 2 * cr);
      ph = ch; pr = cr;
    }
  }

  private checkCollapse(omega: number) {
    if (this.failed || this.H < 70) return;
    // 偏摆失控: 口沿甩出太多直接塌
    const rTop = this.r[RINGS - 1];
    if (this.wobble > 0.55 * rTop + 10) {
      this.collapsed = true; this.collapseReason = 'wobble'; return;
    }
    const flare = this.rimFlare();
    if (flare > FLARE_LIMIT) {
      this.collapsed = true; this.collapseReason = 'flare'; return;
    }
    const flareMult = 1 + Math.max(0, flare - FLARE_SOFT) * 2;

    // 自重(上部泥环压在下部) + 离心力 vs 壁厚决定的生坯强度
    let massAbove = 0;
    for (let i = RINGS - 1; i >= this.floorRings(); i--) {
      const t = this.thickness(i);
      if (t < T_MIN) { this.collapsed = true; this.collapseReason = 'thin'; return; }
      const stress =
        GRAV_C * massAbove / (2 * Math.PI * this.r[i] * t) +
        CENT_C * RHO * omega * omega * this.r[i] * this.r[i];
      let strength = this.clay.strength * Math.pow(t / 6, 1.5) * (1 - this.crack * 0.5);
      if (i >= RINGS - 12) strength /= flareMult;
      if (stress > strength) { this.collapsed = true; this.collapseReason = 'load'; return; }
      massAbove += this.v[i] * RHO;
    }
  }

  // --- 修坯: 刀具在高度 yCut、半径 toolR 处切削, 返回切掉的体积 mm^3 ---
  trimAt(yCut: number, toolR: number): number {
    let removed = 0;
    for (let i = 0; i < RINGS; i++) {
      const cy = this.y[i] + this.h[i] * 0.5;
      if (Math.abs(cy - yCut) > 6) continue;
      const ir = this.innerR(i);
      const newR = Math.max(toolR, ir + 0.5);
      if (this.r[i] > newR) {
        removed += Math.PI * (this.r[i] * this.r[i] - newR * newR) * this.h[i];
        this.r[i] = newR;
        this.v[i] = Math.PI * (newR * newR - ir * ir) * this.h[i];
      }
    }
    return removed;
  }

  /** 阴干: 整体按线收缩率缩小 */
  dry(): number {
    const s = 1 - this.clay.shrinkage;
    for (let i = 0; i < RINGS; i++) {
      this.r[i] *= s; this.h[i] *= s; this.v[i] *= s * s * s;
    }
    this.updateHeights();
    return s;
  }

  /** 存档(作品架): 降采样到 60 环, h/v 按比例放大以保住总高与总体积 */
  serialize() {
    const K = RINGS / 60;
    const r: number[] = [], h: number[] = [], v: number[] = [];
    for (let k = 0; k < 60; k++) {
      const i = Math.min(RINGS - 1, Math.floor(k * RINGS / 60));
      r.push(+this.r[i].toFixed(2));
      h.push(+(this.h[i] * K).toFixed(3));
      v.push(+(this.v[i] * K).toFixed(1));
    }
    return { clayId: this.clay.id, r, h, v, date: new Date().toISOString() };
  }

  static deserialize(clay: ClaySpec, data: { r: number[]; h: number[]; v: number[] }): ClaySim {
    const sim = new ClaySim(clay);
    const n = data.r.length;
    const K = RINGS / n;
    for (let i = 0; i < RINGS; i++) {
      const src = Math.min(n - 1, Math.floor(i * n / RINGS));
      sim.r[i] = data.r[src];
      sim.h[i] = data.h[src] / K;
      sim.v[i] = data.v[src] / K;
    }
    sim.wobble = 0;
    sim.updateHeights();
    return sim;
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
