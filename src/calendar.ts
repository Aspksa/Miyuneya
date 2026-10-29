// Calendar labels follow the user's local timezone; stored timestamps remain absolute ISO instants.
export function formatNoteDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long'}).format(new Date(value));
}
export function formatToday(value: Date = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', {weekday:'long',day:'numeric',month:'long'}).format(value);
}

export function localDateKey(value: Date = new Date()): string { return [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-'); }
