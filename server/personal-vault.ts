import { mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWrite } from '../scripts/runtime.mjs';

export type SavedMessage = { role: 'user' | 'assistant'; content: string };
export type SavedConversation = { id: string; title: string; createdAt: string; updatedAt: string; messages: SavedMessage[] };
type ChatIndex = { revision: number; conversations: SavedConversation[]; selectedId: string | null };
type AvatarRecord = { id: string; name: string; type: string; size: number; createdAt: string };
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const LIMIT_CHAT_BYTES = 8_000_000;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 35 && !Number.isNaN(Date.parse(value));
const validMessages = (value: unknown): value is SavedMessage[] => Array.isArray(value) && value.length <= 2000 && value.every(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 20_000);
function validChats(input: unknown): input is ChatIndex {
  if (!input || typeof input !== 'object') return false;
  const c = input as ChatIndex;
  if (!Number.isSafeInteger(c.revision) || c.revision < 0 || !Array.isArray(c.conversations) || c.conversations.length > 100) return false;
  const ids = new Set<string>();
  for (const row of c.conversations) {
    if (!row || !validId(row.id) || ids.has(row.id) || typeof row.title !== 'string' || row.title.length > 140
      || !validDate(row.createdAt) || !validDate(row.updatedAt) || !validMessages(row.messages)) return false;
    ids.add(row.id);
  }
  return c.selectedId === null || (validId(c.selectedId) && ids.has(c.selectedId));
}
function validAvatarIndex(value: unknown): value is AvatarRecord[] {
  return Array.isArray(value) && value.length <= 20 && value.every(v => v && validId(v.id) && typeof v.name === 'string'
    && v.name.length <= 100 && TYPES[v.type] && Number.isSafeInteger(v.size) && v.size > 0 && v.size <= 15_000_000 && validDate(v.createdAt))
    && new Set(value.map(v => v.id)).size === value.length;
}
const chatEmpty = (): ChatIndex => ({ revision: 0, conversations: [], selectedId: null });
async function readJsonOr<T>(path: string, fallback: T, guard: (value: unknown) => value is T): Promise<T> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw e; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Повреждены пользовательские данные: ' + path + '. Сохраните файл для восстановления.'); }
  if (!guard(parsed)) throw new Error('Некорректные пользовательские данные: ' + path + '. Перезапись запрещена.');
  return parsed;
}
export async function openPersonalVault(dataDir: string) {
  const chatsFile = join(dataDir, 'chats', 'index.json');
  const prefsFile = join(dataDir, 'ui-preferences.json');
  const avatarDir = join(dataDir, 'avatars');
  const avatarIndex = join(avatarDir, 'index.json');
  let chats = await readJsonOr(chatsFile, chatEmpty(), validChats);
  let preferences = await readJsonOr(prefsFile, {} as Record<string, unknown>,
    (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length <= 15_000);
  let avatars = await readJsonOr(avatarIndex, [] as AvatarRecord[], validAvatarIndex);
  let pending: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = pending.then(fn);
    pending = next.catch(() => {});
    return next;
  };
  return {
    chats: () => structuredClone(chats),
    saveChats(input: unknown) {
      return exclusive(async () => {
        if (!validChats(input) || Buffer.byteLength(JSON.stringify(input)) > LIMIT_CHAT_BYTES)
          throw Object.assign(new Error('История переписки слишком большая или имеет неверный формат.'), { status: 400 });
        if (input.revision !== chats.revision)
          throw Object.assign(new Error('История изменилась в другой вкладке. Перезагрузите чат, чтобы не потерять изменения.'), { status: 409 });
        const next = { ...structuredClone(input), revision: chats.revision + 1 };
        await atomicWrite(chatsFile, JSON.stringify(next, null, 2));
        chats = next;
        return structuredClone(chats);
      });
    },
    preferences: () => structuredClone(preferences),
    patchPreferences(input: unknown) {
      return exclusive(async () => {
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(key => !['avatar', 'studio', 'selectedAvatar'].includes(key))
          || JSON.stringify(input).length > 6000)
          throw Object.assign(new Error('Неверный формат настроек аватара и чата.'), { status: 400 });
        const next = { ...preferences, ...input };
        if (JSON.stringify(next).length > 15000)
          throw Object.assign(new Error('Настройки слишком большие.'), { status: 413 });
        await atomicWrite(prefsFile, JSON.stringify(next, null, 2));
        preferences = next;
        return structuredClone(preferences);
      });
    },
    avatars: () => structuredClone(avatars),
    async avatar(id: string) {
      const entry = avatars.find(v => v.id === id);
      if (!entry) return null;
      const bytes = await readFile(join(avatarDir, id + '.' + TYPES[entry.type]));
      return { entry, bytes };
    },
    addAvatar(bytes: Buffer, type: string, name: string, id?: string) {
      return exclusive(async () => {
        if (!TYPES[type] || bytes.length === 0 || bytes.length > 15_000_000 || typeof name !== 'string' || name.length > 100)
          throw Object.assign(new Error('Неверный формат аватара.'), { status: 400 });
        if (avatars.length >= 20) throw Object.assign(new Error('Можно хранить не более 20 образов.'), { status: 409 });
        const safeId = id && validId(id) ? id : randomUUID();
        if (avatars.some(v => v.id === safeId)) return avatars.find(v => v.id === safeId)!; // idempotent migration
        const item: AvatarRecord = { id: safeId, name: name || 'Аватар', type, size: bytes.length, createdAt: new Date().toISOString() };
        await mkdir(avatarDir, { recursive: true });
        const destination = join(avatarDir, safeId + '.' + TYPES[type]);
        await atomicWrite(destination, bytes);
        try { await atomicWrite(avatarIndex, JSON.stringify([...avatars, item], null, 2)); }
        catch (error) { await rm(destination, { force: true }); throw error; }
        avatars = [...avatars, item];
        return item;
      });
    },
    removeAvatar(id: string) {
      return exclusive(async () => {
        const item = avatars.find(v => v.id === id);
        if (!item) return false;
        const next = avatars.filter(v => v.id !== id);
        await atomicWrite(avatarIndex, JSON.stringify(next, null, 2));
        avatars = next;
        await rm(join(avatarDir, id + '.' + TYPES[item.type]), { force: true });
        return true;
      });
    },
    shutdown: async () => { await pending; }
  };
}
