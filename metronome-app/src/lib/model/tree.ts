/** Helpers for editing the item tree from the builder UI. All mutate in place. */
import { newId, type BlockItem, type Item, type PauseItem, type RepeatItem } from './types';

export interface Location {
  list: Item[];
  index: number;
  /** The repeat containing the list, if any. */
  parent: RepeatItem | null;
  /** Location of the parent repeat. */
  parentLoc: Location | null;
}

export function locate(items: Item[], id: string, parent: RepeatItem | null = null, parentLoc: Location | null = null): Location | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.id === id) return { list: items, index: i, parent, parentLoc };
    if (it.kind === 'repeat') {
      const here: Location = { list: items, index: i, parent, parentLoc };
      const found = locate(it.items, id, it, here);
      if (found) return found;
    }
  }
  return null;
}

export function remove(items: Item[], id: string) {
  const loc = locate(items, id);
  if (!loc) return;
  loc.list.splice(loc.index, 1);
  // Remove a repeat left empty.
  if (loc.parent && loc.parent.items.length === 0 && loc.parentLoc) {
    loc.parentLoc.list.splice(loc.parentLoc.index, 1);
  }
}

/** Move an item one step; at the edge of a repeat it steps out of it. */
export function move(items: Item[], id: string, dir: -1 | 1) {
  const loc = locate(items, id);
  if (!loc) return;
  const { list, index } = loc;
  const target = index + dir;
  if (target >= 0 && target < list.length) {
    [list[index], list[target]] = [list[target], list[index]];
    return;
  }
  if (loc.parentLoc) {
    const [it] = list.splice(index, 1);
    const p = loc.parentLoc;
    p.list.splice(dir < 0 ? p.index : p.index + 1, 0, it);
    if (loc.parent!.items.length === 0) {
      const at = p.list.indexOf(loc.parent!);
      if (at >= 0) p.list.splice(at, 1);
    }
  }
}

/** If the previous sibling is a repeat, move this item to the end of it. */
export function joinPrevious(items: Item[], id: string): boolean {
  const loc = locate(items, id);
  if (!loc || loc.index === 0) return false;
  const prev = loc.list[loc.index - 1];
  if (prev.kind !== 'repeat') return false;
  const [it] = loc.list.splice(loc.index, 1);
  prev.items.push(it);
  return true;
}

export function canJoinPrevious(items: Item[], id: string): boolean {
  const loc = locate(items, id);
  return !!loc && loc.index > 0 && loc.list[loc.index - 1].kind === 'repeat';
}

export function clone<T extends Item>(it: T): T {
  const copy = structuredClone(it) as T;
  const reid = (x: Item) => {
    x.id = newId();
    if (x.kind === 'repeat') x.items.forEach(reid);
  };
  reid(copy);
  return copy;
}

export function duplicate(items: Item[], id: string) {
  const loc = locate(items, id);
  if (!loc) return;
  const copy = clone(loc.list[loc.index]);
  // A duplicate continues the music: don't repeat a rehearsal mark or renumbering.
  if (copy.kind !== 'repeat') delete copy.mark;
  if (copy.kind === 'bars') delete copy.barNumber;
  loc.list.splice(loc.index + 1, 0, copy);
}

export function wrapInRepeat(items: Item[], id: string) {
  const loc = locate(items, id);
  if (!loc) return;
  const rep: RepeatItem = { kind: 'repeat', id: newId(), times: 2, items: [loc.list[loc.index]] };
  loc.list.splice(loc.index, 1, rep);
}

export function unwrap(items: Item[], id: string) {
  const loc = locate(items, id);
  if (!loc) return;
  const rep = loc.list[loc.index];
  if (rep.kind !== 'repeat') return;
  loc.list.splice(loc.index, 1, ...rep.items);
}

export function newBlock(): BlockItem {
  return { kind: 'bars', id: newId(), bars: 4 };
}
export function newPause(): PauseItem {
  return { kind: 'pause', id: newId() };
}
export function newRepeat(): RepeatItem {
  return { kind: 'repeat', id: newId(), times: 2, items: [newBlock()] };
}
