// Generated from src/appearance.ts by npm run build.
// Accent colour, corner rounding and interface scale. Stored per browser in localStorage
// and applied as CSS variables on <html>; the light/dark theme itself stays in the workspace.




// Thirty muted tones that sit next to the original gold and jade.
export const accents                     = [
  ['Золото', '#986f24'], ['Шампань', '#a88a52'], ['Горчица', '#b0952a'], ['Бронза', '#8c5a2b'], ['Медь', '#b0602f'],
  ['Терракота', '#a84f3a'], ['Коралл', '#b5544c'], ['Киноварь', '#a8362e'], ['Гранат', '#8e2c3c'], ['Сакура', '#c06d86'],
  ['Пион', '#a8457a'], ['Слива', '#7d3c63'], ['Морион', '#5b4a5e'], ['Фиалка', '#7e5aa6'], ['Лаванда', '#7867a8'],
  ['Аметист', '#62409a'], ['Индиго', '#4a52a0'], ['Сапфир', '#2f5f9e'], ['Лазурь', '#2a72a1'], ['Петроль', '#1f5f6b'],
  ['Бирюза', '#237a7a'], ['Морская волна', '#287965'], ['Нефрит', '#3f7f5f'], ['Малахит', '#2e7d4f'], ['Шалфей', '#5e7955'],
  ['Фисташка', '#8a9a4a'], ['Олива', '#737a2c'], ['Мох', '#5a6b3a'], ['Сталь', '#5f7280'], ['Графит', '#4f5357'],
];
export const radii                             = [['sharp', 'Острые', 0.3], ['normal', 'Обычные', 1], ['round', 'Круглые', 1.75]];
export const scales                            = [['small', 'Мельче', 0.9], ['normal', 'Обычный', 1], ['large', 'Крупнее', 1.12]];
export const defaultAppearance = ()             => ({ accent: accents[0][1], radius: 'normal', scale: 'normal' });
export const accentName = (hex        ) => accents.find(([, value]) => value === hex.toLowerCase())?.[0] || 'Свой';

const validHex = (value         )                  => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function normalizeAppearance(value         )             {
  const input = (value && typeof value === 'object' ? value : {})                       ;
  const base = defaultAppearance();
  return {
    accent: validHex(input.accent) ? input.accent.toLowerCase() : base.accent,
    radius: radii.some(([key]) => key === input.radius) ? input.radius  : base.radius,
    scale: scales.some(([key]) => key === input.scale) ? input.scale  : base.scale,
  };
}
export function loadAppearance() {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem('miyuneya.appearance') || '{}')); } catch { return defaultAppearance(); }
}
export function saveAppearance(value            ) {
  try { localStorage.setItem('miyuneya.appearance', JSON.stringify(value)); } catch {}
}

const rgb = (hex        ) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (channels          ) => '#' + channels.map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');
// t = share of b in the result.
export const mix = (a        , b        , t        ) => { const x = rgb(a), y = rgb(b); return toHex(x.map((c, i) => c + (y[i] - c) * t)); };
export function luminance(hex        ) {
  const [r, g, b] = rgb(hex).map(c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a        , b        ) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
// Derives every accent variable for the current theme from one colour.
export function accentPalette(accent        , dark         ) {
  const main = dark ? mix(accent, '#ffffff', 0.38) : accent;
  return {
    accent: main,
    tint: dark ? mix(accent, '#1b1d1b', 0.76) : mix(accent, '#f8f7f4', 0.87),
    glow: mix(accent, '#ffffff', dark ? 0.55 : 0.45),
    on: contrast(main, '#ffffff') >= contrast(main, '#221e14') ? '#ffffff' : '#221e14',
  };
}
export function applyAppearance(value            , dark         ) {
  const style = document.documentElement.style;
  const colors = accentPalette(value.accent, dark);
  style.setProperty('--gold', colors.accent);
  style.setProperty('--tint', colors.tint);
  style.setProperty('--glow', colors.glow);
  style.setProperty('--on-accent', colors.on);
  style.setProperty('--round', String(radii.find(([key]) => key === value.radius) [2]));
  style.setProperty('--ui-scale', String(scales.find(([key]) => key === value.scale) [2]));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1d1b' : '#f8f7f4');
}
