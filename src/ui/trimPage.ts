import { LatheRenderer } from '../render/renderer';
import { addToShelf } from './store';
import type { App } from '../main';

// 修坯页: 坯已阴到皮革硬度, 不再流动。指针控制刀具高度与进刀半径, 按住切削。
export function mountTrim(root: HTMLElement, app: App): () => void {
  const sim = app.sim!;
  root.className = 'page wheel';
  root.innerHTML = `
    <div class="stage">
      <canvas id="gl"></canvas>
      <div class="toolline" id="tool" hidden></div>
      <div class="hint">修坯: 移动指针定位刀具, <b>按住</b>切削。切掉的泥会实时从坯体上去除。</div>
    </div>
    <aside class="side">
      <h2>修坯 · ${sim.clay.name}</h2>
      <div class="row">坯高 <b id="hh"></b> mm</div>
      <div class="row">刀具高度 <b id="ty">–</b> mm · 进刀半径 <b id="tr">–</b> mm</div>
      <div class="row">已修掉 <b id="removed">0</b> cm³</div>
      <button id="done">完成修坯 → 阴干入架</button>
      <button id="back" class="ghost">回拉坯台</button>
      <p class="tip">阴干后坯体会按 ${(sim.clay.shrinkage * 100).toFixed(0)}% 的线收缩率变小, 作品架上看到的是收缩后的尺寸。</p>
    </aside>`;

  const canvas = root.querySelector<HTMLCanvasElement>('#gl')!;
  const renderer = new LatheRenderer(canvas);
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const toolEl = $('#tool');

  const ptr = { x: 0, y: 0, inside: false, down: false };
  let removed = 0, raf = 0, last = performance.now();

  canvas.addEventListener('pointermove', e => {
    const rc = canvas.getBoundingClientRect();
    ptr.x = (e.clientX - rc.left) * canvas.width / rc.width;
    ptr.y = (e.clientY - rc.top) * canvas.height / rc.height;
    ptr.inside = true;
  });
  canvas.addEventListener('pointerleave', () => { ptr.inside = false; });
  canvas.addEventListener('pointerdown', () => { ptr.down = true; });
  const onUp = () => { ptr.down = false; };
  addEventListener('pointerup', onUp);
  $('#back').addEventListener('click', () => app.go('#/wheel'));
  $('#done').addEventListener('click', () => {
    sim.dry();
    const data = sim.serialize();
    addToShelf({ ...data, name: `${sim.clay.name}作品`, shrunk: true });
    app.sim = null;
    app.go('#/shelf');
  });

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (ptr.inside) {
      const p0 = renderer.project(0, 0, 0), p100 = renderer.project(0, 100, 0);
      const pxPerMmY = (p0.y - p100.y) / 100;
      const yMm = (p0.y - ptr.y) / Math.max(pxPerMmY, 1e-6);
      const q0 = renderer.project(0, yMm, 0), q1 = renderer.project(50, yMm, 0);
      const pxPerMmX = Math.abs(q1.x - q0.x) / 50;
      const toolR = Math.abs(ptr.x - q0.x) / Math.max(pxPerMmX, 1e-6);
      if (ptr.down && yMm > -5 && yMm < sim.H + 5) {
        removed += sim.trimAt(yMm, toolR) / 1000; // mm³ → cm³
      }
      $('#ty').textContent = yMm.toFixed(0);
      $('#tr').textContent = toolR.toFixed(1);
      toolEl.hidden = false;
      const dpr = canvas.width / canvas.clientWidth;
      toolEl.style.top = `${ptr.y / dpr}px`;
    } else toolEl.hidden = true;
    $('#hh').textContent = sim.H.toFixed(0);
    $('#removed').textContent = removed.toFixed(1);
    renderer.render(sim, dt);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); removeEventListener('pointerup', onUp); };
}
