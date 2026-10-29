// Generated from src/model.ts by npm run build.
                                                                                  
                                                                                   
                                                                                                                                   
export function emptyWorkspace()            {
  return { version: 1, notes: [], tasks: [], settings: { theme: 'light', name: 'Хозяин' } };
}
function record(value         )                                   { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value         , max        )                  { return typeof value === 'string' && value.length <= max; }
function date(value         )                  { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function validateWorkspace(value         )                     {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.notes) || !Array.isArray(value.tasks) || !record(value.settings)) return false;
  if (value.notes.length > 5000 || value.tasks.length > 5000 || !['light', 'dark', 'auto'].includes(String(value.settings.theme)) || !text(value.settings.name, 80)) return false;
  const ids = new Set        ();
  for (const item of [...value.notes, ...value.tasks]) {
    if (!record(item) || !text(item.id, 100) || !item.id || ids.has(item.id) || !text(item.title, 200) || !item.title.trim()) return false;
    ids.add(item.id);
  }
  return value.notes.every(n => record(n) && text(n.body, 100000) && date(n.updatedAt)) && value.tasks.every(t => record(t) && typeof t.done === 'boolean' && date(t.createdAt));
}
export function searchNotes(notes        , query        )         {
  const q = query.trim().toLocaleLowerCase('ru');
  return notes.filter(n => `${n.title} ${n.body}`.toLocaleLowerCase('ru').includes(q)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
                                                              
                                                                                                            
// Notes and tasks share one list: newest first, open tasks above finished ones.
export function combineEntries(data                                    , query        , filter              = 'all')          {
  const q = query.trim().toLocaleLowerCase('ru');
  const notes          = filter === 'all' || filter === 'notes' ? searchNotes(data.notes, q).map(item => ({ kind: 'note', item, date: item.updatedAt })) : [];
  const tasks          = filter === 'notes' ? [] : data.tasks.filter(t => t.title.toLocaleLowerCase('ru').includes(q) && (filter === 'all' || t.done === (filter === 'done'))).map(item => ({ kind: 'task', item, date: item.createdAt }));
  const finished = (e       ) => e.kind === 'task' && e.item.done ? 1 : 0;
  return [...notes, ...tasks].sort((a, b) => finished(a) - finished(b) || b.date.localeCompare(a.date));
}
