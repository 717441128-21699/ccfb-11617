import { describe, it, expect } from 'vitest';
import { CLAYS } from './clays';
import { ClaySim, RINGS } from './claySim';
import { playOptimally } from './optimizer';

describe('经验表: 最大坯高/壁厚比', () => {
  for (const clay of CLAYS) {
    it(`${clay.name} 与经验表相差不超过 15%`, () => {
      const sim = new ClaySim(clay);
      const ratio = playOptimally(sim);
      const err = Math.abs(ratio - clay.maxRatio) / clay.maxRatio;
      expect(err, `ratio=${ratio.toFixed(1)} table=${clay.maxRatio}`).toBeLessThanOrEqual(0.15);
    });
  }
});

describe('定中心', () => {
  it('没定中心就往上拉, 偏摆越拉越大', () => {
    const sim = new ClaySim(CLAYS[2]); // 炻器土
    const w0 = sim.wobble;
    let maxWobble = w0;
    const dt = 1 / 60;
    for (let t = 0; t < 40 && !sim.failed; t += dt) {
      const phase = (t % 2) / 2;
      sim.step(dt, { active: true, y: sim.H * (0.2 + 0.7 * phase), pressure: 0.55, sponge: true });
      maxWobble = Math.max(maxWobble, sim.wobble);
    }
    expect(maxWobble).toBeGreaterThan(w0 * 2);
  });

  it('先定中心再拉, 偏摆保持收敛', () => {
    const sim = new ClaySim(CLAYS[2]);
    const dt = 1 / 60;
    for (let t = 0; t < 90 && sim.wobble > 0.4; t += dt) {
      sim.step(dt, { active: true, y: sim.H * 0.35, pressure: 0.7, sponge: true });
    }
    expect(sim.wobble).toBeLessThan(0.5);
  });
});

describe('水与拧裂', () => {
  it('水加少了继续上手, 泥被拧裂', () => {
    const sim = new ClaySim(CLAYS[3]); // 白瓷土最敏感
    sim.water = 0.05;
    const dt = 1 / 60;
    for (let t = 0; t < 30 && !sim.cracked; t += dt) {
      sim.step(dt, { active: true, y: sim.H * 0.5, pressure: 0.8, sponge: false });
    }
    expect(sim.cracked).toBe(true);
  });

  it('勤补水则不会拧裂', () => {
    const sim = new ClaySim(CLAYS[3]);
    const dt = 1 / 60;
    for (let t = 0; t < 30 && !sim.failed; t += dt) {
      sim.step(dt, { active: true, y: sim.H * 0.5, pressure: 0.5, sponge: true });
    }
    expect(sim.cracked).toBe(false);
  });
});

describe('塌坯判定', () => {
  it('壁厚低于临界值即塌', () => {
    const sim = new ClaySim(CLAYS[2]);
    // 手工捏一个高而薄、壁厚低于 T_MIN 的坯
    for (let i = 0; i < RINGS; i++) {
      sim.h[i] = 200 / RINGS;
      sim.r[i] = 45;
      const ir = 45 - 1.2;
      sim.v[i] = Math.PI * (45 * 45 - ir * ir) * sim.h[i];
    }
    sim.updateHeights();
    sim.step(1 / 60, { active: false, y: 0, pressure: 0, sponge: false });
    expect(sim.collapsed).toBe(true);
    expect(sim.collapseReason).toBe('thin');
  });

  it('口沿外撇过多即塌', () => {
    const sim = new ClaySim(CLAYS[2]);
    for (let i = 0; i < RINGS; i++) {
      sim.h[i] = 150 / RINGS;
      const flare = i > RINGS - 12 ? (i - (RINGS - 12)) * 4 : 0;
      sim.r[i] = 40 + flare;
      const ir = sim.r[i] - 5;
      sim.v[i] = Math.PI * (sim.r[i] ** 2 - ir * ir) * sim.h[i];
    }
    sim.updateHeights();
    sim.step(1 / 60, { active: false, y: 0, pressure: 0, sponge: false });
    expect(sim.collapsed).toBe(true);
    expect(sim.collapseReason).toBe('flare');
  });
});

describe('修坯与阴干', () => {
  it('刀具切掉的体积与几何一致', () => {
    const sim = new ClaySim(CLAYS[1]);
    const i = RINGS - 20;
    const yCut = sim.y[i] + sim.h[i] / 2;
    const toolR = sim.r[i] - 5;
    const removed = sim.trimAt(yCut, toolR);
    expect(removed).toBeGreaterThan(0);
    expect(sim.r[i]).toBeCloseTo(toolR, 3);
    // 该环切掉的几何体积
    const expectOne = Math.PI * ((toolR + 5) ** 2 - toolR ** 2) * sim.h[i];
    expect(removed).toBeGreaterThan(expectOne * 0.9); // 含相邻带内环
    expect(sim.thickness(i)).toBeCloseTo(toolR - sim.innerR(i), 3);
  });

  it('阴干后按收缩率变小', () => {
    const sim = new ClaySim(CLAYS[3]); // 白瓷土收缩 14%
    const h0 = sim.H, r0 = sim.r[RINGS - 1];
    sim.dry();
    expect(sim.H).toBeCloseTo(h0 * (1 - 0.14), 3);
    expect(sim.r[RINGS - 1]).toBeCloseTo(r0 * (1 - 0.14), 3);
  });

  it('存档往返保持总高与总体积', () => {
    const sim = new ClaySim(CLAYS[1]);
    playOptimally(sim);
    if (sim.failed) return; // 拉塌了就不验存档
    const data = sim.serialize();
    const back = ClaySim.deserialize(CLAYS[1], data);
    expect(back.H).toBeCloseTo(sim.H, 0);
    let v0 = 0, v1 = 0;
    for (let i = 0; i < RINGS; i++) { v0 += sim.v[i]; v1 += back.v[i]; }
    expect(v1 / v0).toBeCloseTo(1, 1);
  });
});
