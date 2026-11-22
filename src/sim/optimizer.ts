import { ClaySim } from './claySim';

// 模拟一位手法稳定的玩家: 先充分定中心, 保持水量, 匀速多道次向上拉。
// 用于标定 strength(scripts/tune.ts) 和验收"最大高厚比符合经验表"(测试)。
export function playOptimally(sim: ClaySim, maxSeconds = 300): number {
  const dt = 1 / 60;
  // 1) 定中心
  for (let t = 0; t < 90 && sim.wobble > 0.4; t += dt) {
    sim.step(dt, { active: true, y: sim.H * 0.35, pressure: 0.7, sponge: true });
  }
  // 2) 多道次拉坯: 手从坯底(实心段)一路匀速扫到口沿下方, 每道 2 秒
  let best = 0;
  for (let t = 0; t < maxSeconds && !sim.failed; t += dt) {
    const phase = (t % 2) / 2;
    const y = sim.H * (0.04 + 0.88 * phase);
    sim.step(dt, { active: true, y, pressure: 0.55, sponge: true });
    if (!sim.failed) {
      const wall = sim.avgWall();
      if (wall > 0) best = Math.max(best, sim.H / wall);
    }
  }
  return best;
}
