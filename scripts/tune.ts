// 标定脚本: 对每种泥料二分搜索 strength, 使标准手法下的最大 高/壁厚 比命中经验表。
// 运行: npm run tune
import { CLAYS } from '../src/sim/clays';
import { ClaySim } from '../src/sim/claySim';
import { playOptimally } from '../src/sim/optimizer';

for (const clay of CLAYS) {
  let lo = 0.2, hi = 6;
  for (let iter = 0; iter < 24; iter++) {
    const mid = (lo + hi) / 2;
    const sim = new ClaySim({ ...clay, strength: mid });
    const ratio = playOptimally(sim);
    if (ratio < clay.maxRatio) lo = mid; else hi = mid;
  }
  const strength = (lo + hi) / 2;
  const check = playOptimally(new ClaySim({ ...clay, strength }));
  const err = ((check - clay.maxRatio) / clay.maxRatio * 100).toFixed(1);
  console.log(`${clay.name} (${clay.id}): strength=${strength.toFixed(3)}  ratio=${check.toFixed(1)}  table=${clay.maxRatio}  err=${err}%`);
}
