// 性能冒烟: 模拟一帧的物理开销(渲染侧顶点重建为 ~2.2 万顶点 × 常数运算, 同量级)
import { CLAYS } from '../src/sim/clays';
import { ClaySim } from '../src/sim/claySim';

const sim = new ClaySim(CLAYS[2]);
const hand = { active: true, y: 40, pressure: 0.6, sponge: false };
// 预热
for (let i = 0; i < 2000; i++) sim.step(1 / 60, hand);
const t0 = performance.now();
const N = 10000;
for (let i = 0; i < N; i++) {
  hand.y = 40 + 20 * Math.sin(i / 30);
  sim.step(1 / 60, hand);
}
const ms = (performance.now() - t0) / N;
console.log(`sim.step 平均耗时: ${(ms * 1000).toFixed(1)} µs/帧 (预算 20000 µs)`);
// 顶点重建等效运算量估算: 21696 顶点 × ~30 次浮点 → 与 sim.step 同阶, 总帧开销远小于 20ms
