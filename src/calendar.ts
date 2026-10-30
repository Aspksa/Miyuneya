// Calendar labels follow the user's local timezone; stored timestamps remain absolute ISO instants.
export function formatNoteDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long'}).format(new Date(value));
}
export function formatToday(value: Date = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', {weekday:'long',day:'numeric',month:'long'}).format(value);
}

export function localDateKey(value: Date = new Date()): string { return [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-'); }
// A due date is a plain YYYY-MM-DD, so it is built from its parts: new Date('2026-10-30')
// is UTC midnight and would show the previous day west of Greenwich.
export function formatDueDate(value: string, today: string = localDateKey()): string {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y,m,d]=value.split('-').map(Number);
  const date=new Date(y,m-1,d);
  const [ty,tm,td]=today.split('-').map(Number);
  const days=Math.round((date.getTime()-new Date(ty,tm-1,td).getTime())/86400000);
  if(days===0) return 'сегодня';
  if(days===1) return 'завтра';
  if(days===-1) return 'вчера';
  const sameYear=ty===y;
  return new Intl.DateTimeFormat('ru-RU',sameYear?{day:'numeric',month:'long'}:{day:'numeric',month:'long',year:'numeric'}).format(date);
}
