// Generated from src/model.ts by npm run build.
import { validTaskGraph } from './productivity.js';



// Avatar appearance travels with the workspace; its screen position stays in the browser.
// avatar 5 is the user's own uploaded image; animate, snap and opacity arrived later and stay optional.


export const defaultAppearance = () => ({
  accent: '#7775d7', railWidth: 'regular', iconSize: 'regular',
  railOpacity: 100, font: 'system', fontSize: 'regular',
  radius: 'regular', density: 'comfortable', motion: true,
  background: 'default', scale: 100, contrast: false
});
const colorValue = (v) => typeof v === 'string' && /^#[a-fA-F0-9]{6}$/.test(v);
const oneOf = (v, allowed) => typeof v === 'string' && allowed.includes(v);
export function validAppearance(v) {
  if (!record(v)) return false;
  const keys = ['theme', ...Object.keys(defaultAppearance())];
  return Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k))
    && oneOf(v.theme, ['light', 'dark', 'auto'])
    && colorValue(v.accent)
    && oneOf(v.railWidth, ['narrow', 'regular', 'wide'])
    && oneOf(v.iconSize, ['small', 'regular', 'large'])
    && Number.isInteger(v.railOpacity) && Number(v.railOpacity) >= 75 && Number(v.railOpacity) <= 100
    && oneOf(v.font, ['system', 'segoe', 'arial', 'georgia'])
    && oneOf(v.fontSize, ['small', 'regular', 'large'])
    && oneOf(v.radius, ['small', 'regular', 'large'])
    && oneOf(v.density, ['compact', 'comfortable'])
    && typeof v.motion === 'boolean'
    && (v.background === 'default' || colorValue(v.background))
    && [90, 100, 110, 120].includes(v.scale)
    && typeof v.contrast === 'boolean';
}
export const defaultLook = ()                          => ({ avatar: 1, size: 'm', mirror: false, hidden: false, animate: true, snap: true, opacity: 1 });
export function emptyWorkspace()            {
  return { version: 1, notes: [], tasks: [], settings: { theme: 'light', name: 'Хозяин' } };
}
function record(value         )                                   { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value         , max        )                  { return typeof value === 'string' && value.length <= max; }
export function validLocalDate(value         )                  { if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const [y,m,d]=value.split('-').map(Number);const date=new Date(0);date.setUTCFullYear(y,m-1,d);return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d; }
function date(value         )                  { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function validLook(value         )                         {
  return record(value) && [1, 2, 3, 4, 5].includes(value.avatar          ) && ['s', 'm', 'l'].includes(value.size          ) && typeof value.mirror === 'boolean' && typeof value.hidden === 'boolean'
    && (value.animate === undefined || typeof value.animate === 'boolean') && (value.snap === undefined || typeof value.snap === 'boolean')
    && (value.opacity === undefined || (typeof value.opacity === 'number' && value.opacity >= 0.2 && value.opacity <= 1));
}
export function validateWorkspace(value         )                     {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.notes) || !Array.isArray(value.tasks) || !record(value.settings)) return false;
  if (value.notes.length > 5000 || value.tasks.length > 5000 || !['light', 'dark', 'auto'].includes(String(value.settings.theme)) || !text(value.settings.name, 80)) return false;
  if (value.settings.assistant !== undefined && !validLook(value.settings.assistant)) return false;
  if (value.settings.appearance !== undefined && !validAppearance({ theme: value.settings.theme, ...value.settings.appearance })) return false;
  const ids = new Set        ();
  for (const item of [...value.notes, ...value.tasks]) {
    if (!record(item) || !text(item.id, 100) || !item.id || ids.has(item.id) || !text(item.title, 200) || !item.title.trim()) return false;
    ids.add(item.id);
  }
  if(value.automationApplied!==undefined && (!Array.isArray(value.automationApplied)||value.automationApplied.length>20000||!value.automationApplied.every(x=>text(x,150))))return false;
  if(!value.tasks.every((t    )=>(t.parentId===undefined||text(t.parentId,100))&&(t.group===undefined||text(t.group,80))&&(t.dependsOn===undefined||Array.isArray(t.dependsOn)&&t.dependsOn.length<=50&&t.dependsOn.every(x=>text(x,100)))&&(t.attachments===undefined||Array.isArray(t.attachments)&&t.attachments.length<=50&&t.attachments.every(a=>record(a)&&['note','file'].includes(String(a.kind))&&text(a.id,100)))&&(t.repeat===undefined||record(t.repeat)&&['day','week','month'].includes(String(t.repeat.unit))&&Number.isInteger(t.repeat.interval)&&Number(t.repeat.interval)>=1&&Number(t.repeat.interval)<=365&&(t.repeat.anchorDay===undefined||Number.isInteger(t.repeat.anchorDay)&&Number(t.repeat.anchorDay)>=1&&Number(t.repeat.anchorDay)<=31))&&(t.repeatOf===undefined||text(t.repeatOf,100))&&(t.seriesId===undefined||text(t.seriesId,100))))return false;
  if(!validTaskGraph(value.tasks          ))return false;
  return value.notes.every(n => record(n) && text(n.body, 100000) && date(n.updatedAt) && (n.pinned===undefined || typeof n.pinned==='boolean')) && value.tasks.every(t => record(t) && typeof t.done === 'boolean' && date(t.createdAt) && (t.details===undefined || text(t.details,10000)) && (t.dueDate===undefined || t.dueDate==='' || validLocalDate(t.dueDate)) && (t.priority===undefined || ['low','normal','high'].includes(String(t.priority))) && (t.updatedAt===undefined || date(t.updatedAt)) && (t.completedAt===undefined || date(t.completedAt)));
}
export function searchNotes(notes        , query        )         {
  const q = query.trim().toLocaleLowerCase('ru');
  return notes.filter(n => `${n.title} ${n.body}`.toLocaleLowerCase('ru').includes(q)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}


// Notes and tasks share one list: newest first, open tasks above finished ones.
export function combineEntries(data                                    , query        , filter              = 'all')          {
  const q = query.trim().toLocaleLowerCase('ru');
  const notes          = filter === 'all' || filter === 'notes' ? searchNotes(data.notes, q).map(item => ({ kind: 'note', item, date: item.updatedAt })) : [];
  const tasks          = filter === 'notes' ? [] : data.tasks.filter(t => `${t.title} ${t.details || ''}`.toLocaleLowerCase('ru').includes(q) && (filter === 'all' || t.done === (filter === 'done'))).map(item => ({ kind: 'task', item, date: item.createdAt }));
  const finished = (e       ) => e.kind === 'task' && e.item.done ? 1 : 0;
  return [...notes, ...tasks].sort((a, b) => finished(a) - finished(b) || (a.kind==='note'&&a.item.pinned?0:1)-(b.kind==='note'&&b.item.pinned?0:1) || b.date.localeCompare(a.date));
}
