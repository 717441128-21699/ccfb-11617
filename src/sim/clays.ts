// 泥料参数表。maxRatio 来自"陶艺师傅经验表":同一种泥、同一转速下,
// 正常手法能拉到的最大 坯高/平均壁厚 之比。模拟器强度系数 strength 按此标定(见 scripts/tune.ts)。
export interface ClaySpec {
  id: string;
  name: string;
  desc: string;
  color: [number, number, number]; // 0..1 RGB
  plasticity: number;      // 塑性: 受压后流动的难易 0..1
  stiffness: number;       // 硬度: 定中心的难度系数 ~1
  strength: number;        // 生坯强度(标定值, 勿手改)
  maxRatio: number;        // 经验表: 最大 坯高/壁厚
  shrinkage: number;       // 阴干线收缩率
  waterUse: number;        // 耗水速度系数
  crackSensitivity: number;// 缺水上手时被拧裂的敏感度
}

export const CLAYS: ClaySpec[] = [
  {
    id: 'earthen', name: '粗陶土',
    desc: '颗粒粗、可塑性好, 新手友好, 但坯体强度一般, 拉不高。',
    color: [0.63, 0.44, 0.31],
    plasticity: 0.88, stiffness: 0.8, strength: 0.607,
    maxRatio: 24, shrinkage: 0.06, waterUse: 0.8, crackSensitivity: 0.6,
  },
  {
    id: 'fine', name: '细陶土',
    desc: '细腻顺滑, 耗水少, 适合拉中等高度的罐、碗。',
    color: [0.78, 0.66, 0.52],
    plasticity: 0.92, stiffness: 0.9, strength: 0.683,
    maxRatio: 30, shrinkage: 0.07, waterUse: 0.9, crackSensitivity: 0.8,
  },
  {
    id: 'stoneware', name: '炻器土',
    desc: '骨架好、站得住, 能拉高器型, 手感偏硬, 定中心要耐心。',
    color: [0.55, 0.52, 0.47],
    plasticity: 0.72, stiffness: 1.15, strength: 0.997,
    maxRatio: 36, shrinkage: 0.055, waterUse: 1.0, crackSensitivity: 1.0,
  },
  {
    id: 'porcelain', name: '白瓷土',
    desc: '又细又"贼", 耗水快、容易拧裂, 但拉得好能出薄胎。',
    color: [0.90, 0.89, 0.86],
    plasticity: 0.58, stiffness: 1.4, strength: 0.661,
    maxRatio: 32, shrinkage: 0.14, waterUse: 1.35, crackSensitivity: 1.6,
  },
  {
    id: 'zisha', name: '紫砂泥',
    desc: '砂性重、成型稳, 适合矮桩壶型, 不适合拉高。',
    color: [0.48, 0.30, 0.24],
    plasticity: 0.62, stiffness: 1.25, strength: 0.498,
    maxRatio: 22, shrinkage: 0.08, waterUse: 0.7, crackSensitivity: 0.9,
  },
];

export function clayById(id: string): ClaySpec {
  const c = CLAYS.find(c => c.id === id);
  if (!c) throw new Error('unknown clay ' + id);
  return c;
}
