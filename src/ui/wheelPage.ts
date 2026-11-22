import { IDLE_HAND, RINGS, type HandInput } from '../sim/claySim';
import { LatheRenderer } from '../render/renderer';
import type { App } from '../main';

// 拉坯台: 指针纵坐标=手的高度, 横向压向泥坯轮廓=压力; 按住空格/W 或"补水"按钮加水。
export function mountWheel(root: HTMLElement, app: App): () => void {
  const sim = app.sim!;
  root.innerHTML = `
    <div class="stage">
      <canvas id="gl"></canvas>
      <div class="hint" id="hint"></div>
      <div class="overlay" id="fail" hidden>
        <div class="panel">
          <h2 id="failTitle"></h2><p id="failDesc"></p>
          <button id="retry">再拉一块</button>
          <button id="backClay" class="ghost">回泥料页</button>
        </div>
      </div>
    </div>
    <aside class="side">
      <h2>${sim.clay.name}</h2>
      <label class="row">转盘转速 <b id="rpmV">120</b> rpm
        <input id="rpm" type="range" min="30" max="220" value="120"></label>
      <div class="row">水量 <div class="bar"><i id="water"></i></div></div>
      <div class="row">偏摆 <b id="wob">–</b> mm</div>
      <div class="row">坯高 <b id="hh">–</b> mm · 平均壁厚 <b id="wall">–</b> mm</div>
      <div class="row">手处壁厚 <b id="handWall">–</b> mm</div>
      <div class="row">拧裂 <div class="bar"><i id="crack" class="bad"></i></div></div>
      <div class="row small">操作延迟 <b id="lat">–</b> ms · 顶点 21696</div>
      <button id="sponge">补水(按住)</button>
      <button id="finish" disabled>完成拉坯 → 去修坯</button>
      <button id="reset" class="ghost">这块重来</button>
      <p class="tip">手感要领: 先在泥坯中下部稳住手把偏摆定到 1mm 以下;
      再一边<b>向上提</b>一边轻压, 泥才会拉高变薄。水少了泥会发涩, 继续硬拉会拧裂。</p>
    </aside>`;
  root.className = 'page wheel';

  const canvas = root.querySelector<HTMLCanvasElement>('#gl')!;
  const renderer = new LatheRenderer(canvas);
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const rpmSlider = root.querySelector<HTMLInputElement>('#rpm')!;

  const ptr = { x: 0, y: 0, inside: false };
  let spongeKey = false, spongeBtn = false;
  let pendingInputAt = 0;
  let raf = 0, last = performance.now();
  let slumpT = -1; // 塌坯动画计时

  const markInput = () => { pendingInputAt = performance.now(); };
  canvas.addEventListener('pointermove', e => {
    const rc = canvas.getBoundingClientRect();
    ptr.x = (e.clientX - rc.left) * canvas.width / rc.width;
    ptr.y = (e.clientY - rc.top) * canvas.height / rc.height;
    ptr.inside = true; markInput();
  });
  canvas.addEventListener('pointerleave', () => { ptr.inside = false; });
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'KeyW') { spongeKey = true; e.preventDefault(); }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'KeyW') spongeKey = false;
  };
  const onPtrUp = () => { spongeBtn = false; };
  addEventListener('keydown', onKeyDown); addEventListener('keyup', onKeyUp);
  addEventListener('pointerup', onPtrUp);
  const spongeEl = $('#sponge');
  spongeEl.addEventListener('pointerdown', e => { e.preventDefault(); spongeBtn = true; });
  rpmSlider.addEventListener('input', () => { sim.rpm = +rpmSlider.value; $('#rpmV').textContent = rpmSlider.value; });
  $('#reset').addEventListener('click', () => { sim.reset(); slumpT = -1; $('#fail').hidden = true; });
  $('#backClay').addEventListener('click', () => app.go('#/clay'));
  $('#retry').addEventListener('click', () => { sim.reset(); slumpT = -1; $('#fail').hidden = true; });
  $('#finish').addEventListener('click', () => app.go('#/trim'));

  // 指针 → 手的物理量
  const hand: HandInput = { ...IDLE_HAND };
  function computeHand() {
    if (!ptr.inside || sim.failed) { hand.active = false; hand.pressure = 0; hand.sponge = spongeKey || spongeBtn; return; }
    const p0 = renderer.project(0, 0, 0), pTop = renderer.project(0, 100, 0);
    const pxPerMmY = (p0.y - pTop.y) / 100;
    const yMm = (p0.y - ptr.y) / Math.max(pxPerMmY, 1e-6);
    // 手的高度处泥坯轮廓的屏幕位置(左右两侧剪影)
    let rAt = 0;
    for (let i = 0; i < RINGS; i++) {
      if (yMm >= sim.y[i] && yMm <= sim.y[i] + sim.h[i]) { rAt = sim.r[i]; break; }
    }
    const sR = renderer.project(rAt, yMm, 0), sL = renderer.project(-rAt, yMm, 0);
    const cx = renderer.project(0, yMm, 0).x;
    const surfX = ptr.x > cx ? sR.x : sL.x;
    const pen = (Math.abs(surfX - cx) - Math.abs(ptr.x - cx)) / (36 * (canvas.width / canvas.clientWidth || 1));
    hand.y = yMm;
    hand.pressure = Math.min(Math.max(pen, 0), 1);
    hand.active = hand.pressure > 0.02 && yMm > -10 && yMm < sim.H + 30;
    hand.sponge = spongeKey || spongeBtn;
  }

  const FAIL_TEXT: Record<string, [string, string]> = {
    thin: ['壁太薄, 塌了', '局部壁厚低于临界值, 撑不住了。拉坯要均匀, 别在一个地方反复抠。'],
    load: ['塌坯了', '壁厚撑不住自重和离心力的组合。先定好中心, 拉得循序渐进, 别把壁拉得太薄。'],
    flare: ['口沿外撇, 塌了', '口沿外翻太多, 悬出去的部分被自重带垮了。及时收一收口。'],
    wobble: ['偏摆失控, 甩塌了', '没定中心就往上拉, 偏摆越拉越大, 最后甩出去了。'],
    crack: ['泥坯被拧裂了', '水加少了, 泥发涩, 上手直接被拧裂。勤补水!'],
  };

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    computeHand();
    if (slumpT < 0) {
      sim.step(dt, hand);
      if (sim.failed) slumpT = 0;
    } else {
      // 塌坯动画: 坯体摊软下去
      slumpT += dt;
      const k = Math.min(slumpT / 1.2, 1);
      for (let i = sim.floorRings(); i < RINGS; i++) {
        sim.r[i] *= 1 + 0.5 * dt * (1 - k);
        sim.h[i] *= 1 - 0.35 * dt * (1 - k);
      }
      sim.wobble *= 1 - 2 * dt;
      sim.updateHeights();
      if (slumpT > 1.2 && $('#fail').hidden) {
        const reason = sim.cracked ? 'crack' : sim.collapseReason;
        const [t, d] = FAIL_TEXT[reason] || FAIL_TEXT.load;
        $('#failTitle').textContent = t; $('#failDesc').textContent = d;
        $('#fail').hidden = false;
      }
    }
    renderer.render(sim, dt);
    canvas.dataset.handY = hand.y.toFixed(1);
    canvas.dataset.pressure = hand.pressure.toFixed(2);
    canvas.dataset.active = String(hand.active);

    // HUD
    $('#water').style.width = `${sim.water * 100}%`;
    $('#crack').style.width = `${sim.crack * 100}%`;
    $('#wob').textContent = sim.wobble.toFixed(1);
    $('#hh').textContent = sim.H.toFixed(0);
    $('#wall').textContent = sim.avgWall().toFixed(1);
    let hw = '–';
    for (let i = 0; i < RINGS; i++) {
      if (hand.y >= sim.y[i] && hand.y <= sim.y[i] + sim.h[i]) { hw = sim.thickness(i).toFixed(1); break; }
    }
    $('#handWall').textContent = hw;
    if (pendingInputAt) {
      $('#lat').textContent = (performance.now() - pendingInputAt).toFixed(1);
      pendingInputAt = 0;
    }
    const hint = $('#hint');
    if (sim.failed) hint.textContent = '';
    else if (sim.wobble > 1) hint.textContent = `先定中心: 在泥坯中下部稳住手, 把偏摆从 ${sim.wobble.toFixed(1)}mm 压到 1mm 以下`;
    else hint.textContent = '中心已定 ✓ 一手轻压一手向上提, 把坯拉高; 注意补水';
    ($('#finish') as HTMLButtonElement).disabled = sim.failed || sim.H < 80;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('pointerup', onPtrUp);
  };
}
