import { CLAYS } from '../sim/clays';
import { ClaySim } from '../sim/claySim';
import type { App } from '../main';

// 泥料选择页
export function mountClay(root: HTMLElement, app: App): () => void {
  root.className = 'page clay';
  root.innerHTML = `
    <h1>选一块泥</h1>
    <p class="sub">不同泥料的塑性、强度、耗水和收缩率都不同。经验表里的"最大高厚比"是师傅手上能拉到的 坯高/壁厚 极限。</p>
    <div class="cards">
      ${CLAYS.map(c => `
        <button class="card" data-id="${c.id}">
          <span class="swatch" style="background: rgb(${c.color.map(x => x * 255 | 0).join(',')})"></span>
          <h3>${c.name}</h3>
          <p>${c.desc}</p>
          <dl>
            <div><dt>塑性</dt><dd>${bar(c.plasticity)}</dd></div>
            <div><dt>定中心难度</dt><dd>${bar(c.stiffness / 1.5)}</dd></div>
            <div><dt>耗水</dt><dd>${bar(c.waterUse / 1.5)}</dd></div>
            <div><dt>阴干收缩</dt><dd>${(c.shrinkage * 100).toFixed(0)}%</dd></div>
            <div><dt>经验高厚比</dt><dd><b>${c.maxRatio}</b></dd></div>
          </dl>
        </button>`).join('')}
    </div>`;
  const onClick = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (!el) return;
    const clay = CLAYS.find(c => c.id === el.dataset.id)!;
    app.sim = new ClaySim(clay);
    app.go('#/wheel');
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

function bar(x: number) {
  const pct = Math.round(Math.min(Math.max(x, 0), 1) * 100);
  return `<span class="bar"><i style="width:${pct}%"></i></span>`;
}
