import { validTaskGraph } from './productivity.ts';
export type Note = { id: string; title: string; body: string; updatedAt: string; pinned?: boolean };
export type Attachment={kind:'note'|'file';id:string};
export type Task = { parentId?:string; dependsOn?:string[]; group?:string; attachments?:Attachment[]; repeat?:{unit:'day'|'week'|'month';interval:number;anchorDay?:number}; repeatOf?:string; seriesId?:string; id: string; title: string; done: boolean; createdAt: string; details?: string; dueDate?: string; priority?: 'low' | 'normal' | 'high'; updatedAt?: string; completedAt?: string };
// Avatar appearance travels with the workspace; its screen position stays in the browser.
// avatar 5 is the user's own uploaded image; animate, snap and opacity arrived later and stay optional.
export type AssistantLook = { avatar: 1 | 2 | 3 | 4 | 5; size: 's' | 'm' | 'l'; mirror: boolean; hidden: boolean; animate?: boolean; snap?: boolean; opacity?: number };
export type Workspace = { version: 1; automationApplied?:string[]; notes: Note[]; tasks: Task[]; settings: { theme: 'light' | 'dark' | 'auto'; name: string; assistant?: AssistantLook } };
export const defaultLook = (): Required<AssistantLook> => ({ avatar: 1, size: 'm', mirror: false, hidden: false, animate: true, snap: true, opacity: 1 });
export function emptyWorkspace(): Workspace {
  return { version: 1, notes: [], tasks: [], settings: { theme: 'light', name: 'Хозяин' } };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max; }
export function validLocalDate(value: unknown): value is string { if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const [y,m,d]=value.split('-').map(Number);const date=new Date(0);date.setUTCFullYear(y,m-1,d);return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d; }
function date(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function validLook(value: unknown): value is AssistantLook {
  return record(value) && [1, 2, 3, 4, 5].includes(value.avatar as number) && ['s', 'm', 'l'].includes(value.size as string) && typeof value.mirror === 'boolean' && typeof value.hidden === 'boolean'
    && (value.animate === undefined || typeof value.animate === 'boolean') && (value.snap === undefined || typeof value.snap === 'boolean')
    && (value.opacity === undefined || (typeof value.opacity === 'number' && value.opacity >= 0.2 && value.opacity <= 1));
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
  if(value.automationApplied!==undefined && (!Array.isArray(value.automationApplied)||value.automationApplied.length>20000||!value.automationApplied.every(x=>text(x,150))))return false;
  if(!value.tasks.every((t:any)=>(t.parentId===undefined||text(t.parentId,100))&&(t.group===undefined||text(t.group,80))&&(t.dependsOn===undefined||Array.isArray(t.dependsOn)&&t.dependsOn.length<=50&&t.dependsOn.every(x=>text(x,100)))&&(t.attachments===undefined||Array.isArray(t.attachments)&&t.attachments.length<=50&&t.attachments.every(a=>record(a)&&['note','file'].includes(String(a.kind))&&text(a.id,100)))&&(t.repeat===undefined||record(t.repeat)&&['day','week','month'].includes(String(t.repeat.unit))&&Number.isInteger(t.repeat.interval)&&Number(t.repeat.interval)>=1&&Number(t.repeat.interval)<=365&&(t.repeat.anchorDay===undefined||Number.isInteger(t.repeat.anchorDay)&&Number(t.repeat.anchorDay)>=1&&Number(t.repeat.anchorDay)<=31))&&(t.repeatOf===undefined||text(t.repeatOf,100))&&(t.seriesId===undefined||text(t.seriesId,100))))return false;
  if(!validTaskGraph(value.tasks as Task[]))return false;
  return value.notes.every(n => record(n) && text(n.body, 100000) && date(n.updatedAt) && (n.pinned===undefined || typeof n.pinned==='boolean')) && value.tasks.every(t => record(t) && typeof t.done === 'boolean' && date(t.createdAt) && (t.details===undefined || text(t.details,10000)) && (t.dueDate===undefined || t.dueDate==='' || validLocalDate(t.dueDate)) && (t.priority===undefined || ['low','normal','high'].includes(String(t.priority))) && (t.updatedAt===undefined || date(t.updatedAt)) && (t.completedAt===undefined || date(t.completedAt)));
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
  const tasks: Entry[] = filter === 'notes' ? [] : data.tasks.filter(t => `${t.title} ${t.details || ''}`.toLocaleLowerCase('ru').includes(q) && (filter === 'all' || t.done === (filter === 'done'))).map(item => ({ kind: 'task', item, date: item.createdAt }));
  const finished = (e: Entry) => e.kind === 'task' && e.item.done ? 1 : 0;
  return [...notes, ...tasks].sort((a, b) => finished(a) - finished(b) || (a.kind==='note'&&a.item.pinned?0:1)-(b.kind==='note'&&b.item.pinned?0:1) || b.date.localeCompare(a.date));
}
