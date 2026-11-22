import { clayById } from '../sim/clays';
import { loadShelf, saveShelf, type ShelfItem } from './store';
import type { App } from '../main';

// 作品架: 阴干后的成品(2D 剪影展示), 数据在 localStorage。
export function mountShelf(root: HTMLElement, app: App): () => void {
  const items = loadShelf();
  root.className = 'page shelf';
  root.innerHTML = `
    <h1>作品架</h1>
    <p class="sub">拉好、修过的坯子阴干后按泥料收缩率变小, 尺寸标注均为收缩后。</p>
    ${items.length === 0 ? '<p class="empty">还什么都没有, 去拉一块吧。</p>' : ''}
    <div class="shelfgrid">
      ${items.map((it, i) => {
        const clay = clayById(it.clayId);
        const H = it.h.reduce((a, b) => a + b, 0);
        return `<div class="piece">
          <canvas data-i="${i}" width="180" height="220"></canvas>
          <h3>${it.name}</h3>
          <p>${clay.name} · 高 ${H.toFixed(0)}mm · 收缩 ${(clay.shrinkage * 100).toFixed(0)}%</p>
          <p class="small">${new Date(it.date).toLocaleString()}</p>
          <button class="ghost del" data-i="${i}">下架</button>
        </div>`;
      }).join('')}
    </div>
    <button id="goClay">去拉坯</button>`;

  items.forEach((it, i) => {
    const cv = root.querySelector<HTMLCanvasElement>(`canvas[data-i="${i}"]`)!;
    drawSilhouette(cv, it);
  });
  const onClick = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.id === 'goClay') app.go('#/clay');
    const del = t.closest<HTMLElement>('.del');
    if (del) {
      const arr = loadShelf();
      arr.splice(+del.dataset.i!, 1);
      saveShelf(arr);
      app.reroute();
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

function drawSilhouette(cv: HTMLCanvasElement, it: ShelfItem) {
  const ctx = cv.getContext('2d')!;
  const clay = clayById(it.clayId);
  const n = it.r.length;
  let H = 0; const ys: number[] = [];
  for (let i = 0; i < n; i++) { ys.push(H); H += it.h[i]; }
  const maxR = Math.max(...it.r);
  const s = Math.min((cv.width - 20) / (2 * maxR), (cv.height - 16) / H);
  const cx = cv.width / 2, y0 = cv.height - 8;
  ctx.fillStyle = '#1b1b1e';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.beginPath();
  ctx.moveTo(cx - it.r[0] * s, y0);
  for (let i = 0; i < n; i++) ctx.lineTo(cx - it.r[i] * s, y0 - (ys[i] + it.h[i]) * s);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(cx + it.r[i] * s, y0 - (ys[i] + it.h[i]) * s);
  ctx.closePath();
  ctx.fillStyle = `rgb(${clay.color.map(x => x * 255 | 0).join(',')})`;
  ctx.fill();
}
