// Calendar labels follow the user's local timezone; stored timestamps remain absolute ISO instants.
export function formatNoteDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long'}).format(new Date(value));
}
export function formatToday(value: Date = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', {weekday:'long',day:'numeric',month:'long'}).format(value);
}
