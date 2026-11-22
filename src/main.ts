import { ClaySim } from './sim/claySim';
import { mountClay } from './ui/clayPage';
import { mountWheel } from './ui/wheelPage';
import { mountTrim } from './ui/trimPage';
import { mountShelf } from './ui/shelfPage';

export interface App {
  sim: ClaySim | null;
  go(hash: string): void;
  reroute(): void;
}

const app: App = {
  sim: null,
  go(hash) { location.hash = hash; },
  reroute() { route(); },
};

const rootEl = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function route() {
  const hash = location.hash || '#/clay';
  cleanup?.(); cleanup = null;
  rootEl.innerHTML = '';
  const needSim = hash.startsWith('#/wheel') || hash.startsWith('#/trim');
  if (needSim && !app.sim) { location.hash = '#/clay'; return; }
  if (hash.startsWith('#/wheel')) cleanup = mountWheel(rootEl, app);
  else if (hash.startsWith('#/trim')) cleanup = mountTrim(rootEl, app);
  else if (hash.startsWith('#/shelf')) cleanup = mountShelf(rootEl, app);
  else cleanup = mountClay(rootEl, app);
  for (const a of document.querySelectorAll<HTMLAnchorElement>('nav a')) {
    a.classList.toggle('active', hash.startsWith(a.getAttribute('href') || ''));
  }
}

addEventListener('hashchange', route);
route();
