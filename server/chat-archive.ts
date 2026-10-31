import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from '../scripts/runtime.mjs';

// Each message is an independently and atomically saved file. Neither the index
// nor a browser tab ever holds the entire archive in memory.
export type ArchiveMessage = {
  id: string; role: 'user' | 'assistant'; content: string;
  createdAt: string; version: number; complete: boolean;
};
export type ArchiveConversation = {
  id: string; title: string; createdAt: string; updatedAt: string;
  messageCount: number; archived: boolean;
};
type ArchiveIndex = {
  schema: 2; revision: number; selectedId: string | null;
  conversations: ArchiveConversation[];
};
type LegacyRow = { id: string; title: string; createdAt: string; updatedAt: string; messages: { role: 'user' | 'assistant'; content: string }[] };
type LegacyIndex = { revision: number; selectedId: string | null; conversations: LegacyRow[] };
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const messageFile = /^([0-9]{12})_([a-zA-Z0-9_-]{1,80})\.json$/;
const dateOk = (value: unknown): value is string => typeof value === 'string' && value.length <= 35 && Number.isFinite(Date.parse(value));
const error = (message: string, status = 400) => Object.assign(new Error(message), { status });
const iso = () => new Date().toISOString();
const validId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value);
function validMeta(row: unknown): row is ArchiveConversation {
  if (!row || typeof row !== 'object') return false;
  const m = row as ArchiveConversation;
  return validId(m.id) && typeof m.title === 'string' && m.title.length <= 140
    && dateOk(m.createdAt) && dateOk(m.updatedAt) && Number.isSafeInteger(m.messageCount)
    && m.messageCount >= 0 && typeof m.archived === 'boolean';
}
function validManifest(value: unknown): value is ArchiveIndex {
  if (!value || typeof value !== 'object') return false;
  const m = value as ArchiveIndex;
  if (m.schema !== 2 || !Number.isSafeInteger(m.revision) || m.revision < 0
    || !Array.isArray(m.conversations) || !m.conversations.every(validMeta)
    || new Set(m.conversations.map(c => c.id)).size !== m.conversations.length) return false;
  return m.selectedId === null || (validId(m.selectedId) && m.conversations.some(c => c.id === m.selectedId));
}
function validMessage(value: unknown): value is ArchiveMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as ArchiveMessage;
  return validId(m.id) && (m.role === 'user' || m.role === 'assistant')
    && typeof m.content === 'string' && m.content.length <= 1_000_000
    && dateOk(m.createdAt) && Number.isSafeInteger(m.version)
    && m.version >= 1 && typeof m.complete === 'boolean';
}
function validLegacy(value: unknown): value is LegacyIndex {
  if (!value || typeof value !== 'object') return false;
  const m = value as LegacyIndex;
  if (!Array.isArray(m.conversations) || !m.conversations.every(row =>
    row && validId(row.id) && typeof row.title === 'string' && row.title.length <= 140
    && dateOk(row.createdAt) && dateOk(row.updatedAt) && Array.isArray(row.messages)
    && row.messages.every(msg => msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string')))
    return false;
  return new Set(m.conversations.map(c => c.id)).size === m.conversations.length;
}
const empty = (): ArchiveIndex => ({ schema: 2, revision: 0, selectedId: null, conversations: [] });
async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
function parseStrict<T>(raw: string, path: string, valid: (value: unknown) => value is T): T {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Повреждён архив: ' + path + '. Сохраните файл. Автоматическая перезапись запрещена.'); }
  if (!valid(parsed)) throw new Error('Некорректная структура архива: ' + path + '. Автоматическая перезапись запрещена.');
  return parsed;
}
export async function openChatArchive(dataDir: string) {
  const home = join(dataDir, 'chats');
  const manifestFile = join(home, 'manifest.json');
  const legacyFile = join(home, 'index.json'); // Original v1 remains untouched, including after migration.
  const folder = join(home, 'conversations');
  const directory = (id: string) => join(folder, id);
  const filePath = (id: string, filename: string) => join(directory(id), filename);
  const metaPath = (id: string) => filePath(id, 'meta.json');
  const position = new Map<string, Map<string, string>>();
  let index: ArchiveIndex;
  const raw = await readOptional(manifestFile);
  if (raw !== null) index = parseStrict(raw, manifestFile, validManifest);
  else {
    index = empty();
    const legacy = await readOptional(legacyFile);
    if (legacy !== null) {
      const old = parseStrict(legacy, legacyFile, validLegacy);
      for (const row of old.conversations) {
        const meta: ArchiveConversation = {
          id: row.id, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt,
          messageCount: row.messages.length, archived: false
        };
        await mkdir(directory(meta.id), { recursive: true });
        // Deterministic names make an interrupted migration safe to resume.
        await atomicWrite(metaPath(meta.id), JSON.stringify(meta));
        for (let i = 0; i < row.messages.length; i++) {
          const msg = row.messages[i];
          const record: ArchiveMessage = {
            id: 'legacy-' + String(i + 1).padStart(12, '0'), role: msg.role,
            content: msg.content, createdAt: row.createdAt, version: 1, complete: true
          };
          if (!validMessage(record)) throw new Error('Не удалось безопасно перенести сообщение старого архива.');
          const name = String(i + 1).padStart(12, '0') + '_' + record.id + '.json';
          await atomicWrite(filePath(meta.id, name), JSON.stringify(record));
        }
        index.conversations.push(meta);
      }
      if (old.selectedId && index.conversations.some(c => c.id === old.selectedId)) index.selectedId = old.selectedId;
      index.revision = old.revision;
      await atomicWrite(manifestFile, JSON.stringify(index, null, 2));
    }
  }

  // Recover a conversation written just before a crash, and reconcile counts
  // when a message was durable but updating the small manifest was interrupted.
  let repaired = false;
  let dirs: string[] = [];
  try { dirs = await readdir(folder); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const known = new Set(index.conversations.map(c => c.id));
  for (const id of dirs) {
    if (!validId(id)) continue;
    const saved = await readOptional(metaPath(id));
    if (saved === null) continue;
    const meta = parseStrict(saved, metaPath(id), validMeta);
    if (meta.id !== id) throw new Error('Не совпадает идентификатор архива: ' + id);
    if (!known.has(id)) { index.conversations.push({ ...meta, messageCount: 0 }); known.add(id); repaired = true; }
  }
  for (const row of index.conversations) {
    let filenames: string[];
    try { filenames = await readdir(directory(row.id)); }
    catch (e) { throw new Error('Отсутствует папка разговора: ' + row.id + '. Архив не будет перезаписан.', { cause: e }); }
    const map = new Map<string, string>();
    const sorted = filenames.filter(name => messageFile.test(name)).sort();
    let number = 0;
    for (const name of sorted) {
      const match = messageFile.exec(name)!;
      number++;
      if (Number(match[1]) !== number || map.has(match[2]))
        throw new Error('Непоследовательный или повторяющийся номер сообщения в ' + row.id + '.');
      map.set(match[2], name);
    }
    if (sorted.length < row.messageCount)
      throw new Error('Отсутствуют сообщения разговора ' + row.id + '. Архив не будет перезаписан.');
    position.set(row.id, map);
    if (row.messageCount !== sorted.length) {
      row.messageCount = sorted.length;
      const last = sorted.at(-1);
      if (last) {
        const modified = await stat(filePath(row.id, last));
        row.updatedAt = new Date(Math.max(Date.parse(row.updatedAt), modified.mtimeMs)).toISOString();
      }
      repaired = true;
    }
  }
  if (repaired) { index.revision++; await atomicWrite(manifestFile, JSON.stringify(index, null, 2)); }

  let pending: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = pending.then(fn);
    pending = next.catch(() => {});
    return next;
  }
  async function persist() {
    const next = { ...index, revision: index.revision + 1 };
    await atomicWrite(manifestFile, JSON.stringify(next, null, 2));
    index.revision = next.revision;
  }
  function getMeta(id: string): ArchiveConversation {
    if (!validId(id)) throw error('Неверный идентификатор разговора.');
    const meta = index.conversations.find(row => row.id === id);
    if (!meta) throw error('Разговор не найден.', 404);
    return meta;
  }
  function list(input: { query?: string; offset?: number; limit?: number; archived?: boolean } = {}) {
    const query = (input.query || '').trim().toLocaleLowerCase('ru').slice(0, 200);
    const offset = Math.max(0, Number.isSafeInteger(input.offset) ? input.offset! : 0);
    const limit = Math.max(1, Math.min(100, Number.isSafeInteger(input.limit) ? input.limit! : 60));
    const results = index.conversations.filter(c => c.archived === !!input.archived
      && (!query || c.title.toLocaleLowerCase('ru').includes(query)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { schema: 2, revision: index.revision, selectedId: index.selectedId,
      total: results.length, conversations: results.slice(offset, offset + limit).map(c => ({ ...c })) };
  }
  function create(input: { id?: string; title?: string } = {}) {
    return exclusive(async () => {
      if (input.id !== undefined && !validId(input.id)) throw error('Неверный идентификатор разговора.');
      if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 140))
        throw error('Слишком длинное название разговора.');
      const id = input.id || randomUUID();
      const existing = index.conversations.find(c => c.id === id);
      if (existing) return { conversation: { ...existing }, selectedId: index.selectedId };
      const now = iso();
      const meta: ArchiveConversation = { id, title: input.title || 'Новый разговор',
        createdAt: now, updatedAt: now, messageCount: 0, archived: false };
      await atomicWrite(metaPath(id), JSON.stringify(meta, null, 2));
      index.conversations.push(meta);
      position.set(id, new Map());
      index.selectedId = id;
      await persist();
      return { conversation: { ...meta }, selectedId: id };
    });
  }
  function modify(id: string, input: { title?: string; archived?: boolean }) {
    return exclusive(async () => {
      const meta = getMeta(id);
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(k => k !== 'title' && k !== 'archived')
        || (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 140))
        || (input.archived !== undefined && typeof input.archived !== 'boolean'))
        throw error('Неверное изменение разговора.');
      if (input.title !== undefined) meta.title = input.title.trim() || 'Без названия';
      if (input.archived !== undefined) meta.archived = input.archived;
      if (meta.archived && index.selectedId === id) index.selectedId = null;
      await persist();
      return { conversation: { ...meta }, selectedId: index.selectedId };
    });
  }
  function select(id: string | null) {
    return exclusive(async () => {
      if (id !== null && getMeta(id).archived) throw error('Разговор находится в архиве.');
      index.selectedId = id;
      await persist();
      return { selectedId: id };
    });
  }
  function saveMessage(conversationId: string, input: unknown, expectedCount?: number) {
    return exclusive(async () => {
      const meta = getMeta(conversationId);
      if (meta.archived) throw error('Разговор в архиве. Сначала восстановите его.', 409);
      if (!validMessage(input)) throw error('Неверное сообщение. Содержимое не сохранено.');
      const msg = input as ArchiveMessage;
      const map = position.get(conversationId)!;
      const existing = map.get(msg.id);
      if (existing) {
        const old = parseStrict(await readFile(filePath(conversationId, existing), 'utf8'),
          filePath(conversationId, existing), validMessage);
        if (old.role !== msg.role || old.createdAt !== msg.createdAt) throw error('Идентификатор сообщения уже занят.', 409);
        if (msg.version < old.version || (msg.version === old.version && msg.content === old.content && msg.complete === old.complete))
          return { message: old, conversation: { ...meta } };
        if (msg.version === old.version || (old.complete && !msg.complete)) throw error('Конфликт версии сообщения.', 409);
        await atomicWrite(filePath(conversationId, existing), JSON.stringify(msg));
      } else {
        if (expectedCount !== undefined && expectedCount !== meta.messageCount)
          throw error('В другой вкладке появились сообщения. Обновите разговор, чтобы не потерять порядок.', 409);
        const name = String(meta.messageCount + 1).padStart(12, '0') + '_' + msg.id + '.json';
        await atomicWrite(filePath(conversationId, name), JSON.stringify(msg));
        map.set(msg.id, name);
        meta.messageCount++;
      }
      meta.updatedAt = iso();
      await persist();
      return { message: msg, conversation: { ...meta } };
    });
  }
  async function page(id: string, before?: number, limit = 100) {
    const meta = getMeta(id);
    const count = meta.messageCount;
    const end = before === undefined ? count : Math.max(0, Math.min(count, before));
    const take = Number.isSafeInteger(limit) ? Math.max(1, Math.min(150, limit)) : 100;
    const start = Math.max(0, end - take);
    const files = [...position.get(id)!.values()];
    const messages: ArchiveMessage[] = [];
    for (const name of files.slice(start, end)) {
      messages.push(parseStrict(await readFile(filePath(id, name), 'utf8'), filePath(id, name), validMessage));
    }
    return { messages, total: count, nextBefore: start > 0 ? start : null };
  }
  async function* exportLines() {
    yield JSON.stringify({ format: 'miyuneya-chats', schema: 2, exportedAt: iso() }) + '\n';
    for (const meta of index.conversations) {
      yield JSON.stringify({ kind: 'conversation', conversation: meta }) + '\n';
      for (const filename of position.get(meta.id)!.values()) {
        const msg = parseStrict(await readFile(filePath(meta.id, filename), 'utf8'),
          filePath(meta.id, filename), validMessage);
        yield JSON.stringify({ kind: 'message', conversationId: meta.id, message: msg }) + '\n';
      }
    }
  }
  async function importLegacy(data: unknown) {
    if (!validLegacy(data)) throw error('Неверный формат резервной копии.');
    let imported = 0;
    for (const row of (data as LegacyIndex).conversations) {
      await create({ id: row.id, title: row.title });
      for (let i = 0; i < row.messages.length; i++) {
        const msg = row.messages[i];
        await saveMessage(row.id, { id: 'legacy-' + String(i + 1).padStart(12, '0'),
          role: msg.role, content: msg.content, createdAt: row.createdAt, version: 1, complete: true });
        imported++;
      }
    }
    return { imported, conversations: (data as LegacyIndex).conversations.length };
  }
  async function importStream(body: AsyncIterable<Uint8Array>, contentType: string) {
    if (contentType.startsWith('application/json')) {
      let raw = '';
      for await (const chunk of body) {
        raw += Buffer.from(chunk).toString('utf8');
        if (Buffer.byteLength(raw) > 32_000_000) throw error('Старый формат JSON больше 32 МБ; конвертируйте его в JSONL.', 413);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw error('Некорректный файл резервной копии.'); }
      return importLegacy(parsed);
    }
    if (!contentType.startsWith('application/x-ndjson')) throw error('Ожидается JSONL или старый JSON.', 415);
    const decoder = new TextDecoder();
    let buffer = '';
    let header = false, count = 0, conversations = 0;
    async function processLine(line: string) {
      if (!line.trim()) return;
      let data: any;
      try { data = JSON.parse(line); } catch { throw error('Повреждённая строка архивного файла.'); }
      if (!header) {
        if (data?.format !== 'miyuneya-chats' || data?.schema !== 2) throw error('Неизвестный формат архива.');
        header = true; return;
      }
      if (data.kind === 'conversation') {
        if (!validMeta(data.conversation)) throw error('Повреждённая информация о разговоре.');
        await create({ id: data.conversation.id, title: data.conversation.title });
        conversations++; return;
      }
      if (data.kind === 'message') {
        if (!validId(data.conversationId)) throw error('Неверный идентификатор диалога.');
        await saveMessage(data.conversationId, data.message);
        count++; return;
      }
      throw error('Неизвестная запись в резервной копии.');
    }
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 2_000_000) throw error('Слишком длинная запись резервной копии.', 413);
      let n: number;
      while ((n = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, n);
        buffer = buffer.slice(n + 1);
        await processLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await processLine(buffer);
    if (!header) throw error('Резервная копия пуста.');
    return { imported: count, conversations };
  }
  return {
    list, create, modify, select, page, saveMessage, exportLines, importStream, importLegacy,
    shutdown: async () => { await pending; }
  };
}
