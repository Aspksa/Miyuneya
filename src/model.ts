export type Note = { id: string; title: string; body: string; updatedAt: string };
export type Task = { id: string; title: string; done: boolean; createdAt: string };
// Avatar appearance travels with the workspace; its screen position stays in the browser.
export type AssistantLook = { avatar: 1 | 2 | 3 | 4; size: 's' | 'm' | 'l'; mirror: boolean; hidden: boolean };
export type Workspace = { version: 1; notes: Note[]; tasks: Task[]; settings: { theme: 'light' | 'dark' | 'auto'; name: string; assistant?: AssistantLook } };
export const defaultLook = (): AssistantLook => ({ avatar: 1, size: 'm', mirror: false, hidden: false });
export function emptyWorkspace(): Workspace {
  return { version: 1, notes: [], tasks: [], settings: { theme: 'light', name: 'Хозяин' } };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max; }
function date(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function validLook(value: unknown): value is AssistantLook {
  return record(value) && [1, 2, 3, 4].includes(value.avatar as number) && ['s', 'm', 'l'].includes(value.size as string) && typeof value.mirror === 'boolean' && typeof value.hidden === 'boolean';
}
export function validateWorkspace(value: unknown): value is Workspace {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.notes) || !Array.isArray(value.tasks) || !record(value.settings)) return false;
  if (value.notes.length > 5000 || value.tasks.length > 5000 || !['light', 'dark', 'auto'].includes(String(value.settings.theme)) || !text(value.settings.name, 80)) return false;
  if (value.settings.assistant !== undefined && !validLook(value.settings.assistant)) return false;
  const ids = new Set<string>();
  for (const item of [...value.notes, ...value.tasks]) {
    if (!record(item) || !text(item.id, 100) || !item.id || ids.has(item.id) || !text(item.title, 200) || !item.title.trim()) return false;
    ids.add(item.id);
  }
  return value.notes.every(n => record(n) && text(n.body, 100000) && date(n.updatedAt)) && value.tasks.every(t => record(t) && typeof t.done === 'boolean' && date(t.createdAt));
}
export function searchNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLocaleLowerCase('ru');
  return notes.filter(n => `${n.title} ${n.body}`.toLocaleLowerCase('ru').includes(q)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export type EntryFilter = 'all' | 'notes' | 'active' | 'done';
export type Entry = { kind: 'note'; item: Note; date: string } | { kind: 'task'; item: Task; date: string };
// Notes and tasks share one list: newest first, open tasks above finished ones.
export function combineEntries(data: Pick<Workspace, 'notes' | 'tasks'>, query: string, filter: EntryFilter = 'all'): Entry[] {
  const q = query.trim().toLocaleLowerCase('ru');
  const notes: Entry[] = filter === 'all' || filter === 'notes' ? searchNotes(data.notes, q).map(item => ({ kind: 'note', item, date: item.updatedAt })) : [];
  const tasks: Entry[] = filter === 'notes' ? [] : data.tasks.filter(t => t.title.toLocaleLowerCase('ru').includes(q) && (filter === 'all' || t.done === (filter === 'done'))).map(item => ({ kind: 'task', item, date: item.createdAt }));
  const finished = (e: Entry) => e.kind === 'task' && e.item.done ? 1 : 0;
  return [...notes, ...tasks].sort((a, b) => finished(a) - finished(b) || b.date.localeCompare(a.date));
}
