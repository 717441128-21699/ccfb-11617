// 作品架存档(localStorage)
export interface ShelfItem {
  clayId: string;
  name: string;
  date: string;      // ISO
  shrunk: boolean;   // 是否已阴干
  r: number[]; h: number[]; v: number[];
}

const KEY = 'pottery.shelf.v1';

export function loadShelf(): ShelfItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as ShelfItem[] : [];
  } catch { return []; }
}

export function saveShelf(items: ShelfItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 空间满就放弃 */ }
}

export function addToShelf(item: ShelfItem) {
  const items = loadShelf();
  items.unshift(item);
  saveShelf(items.slice(0, 60));
}
