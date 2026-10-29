// Generated from src/calendar.ts by npm run build.
// Calendar labels follow the user's local timezone; stored timestamps remain absolute ISO instants.
export function formatNoteDate(value        )         {
  return new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long'}).format(new Date(value));
}
export function formatToday(value       = new Date())         {
  return new Intl.DateTimeFormat('ru-RU', {weekday:'long',day:'numeric',month:'long'}).format(value);
}
