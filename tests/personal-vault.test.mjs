import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPersonalVault } from '../server/personal-vault.ts';

async function withVault(t) {
  const root = await mkdtemp(join(tmpdir(), 'miyuneya-vault-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, vault: await openPersonalVault(root) };
}
const conversation = (id='chat-1') => ({
  id, title: 'Разговор', createdAt: '2026-10-31T12:00:00.000Z',
  updatedAt: '2026-10-31T12:00:00.000Z',
  messages: [{ role: 'user', content: 'Привет' }, { role: 'assistant', content: 'Здравствуйте!' }]
});

test('История хранится на диске, переживает новый сеанс и блокирует конфликты', async t => {
  const { root, vault } = await withVault(t);
  assert.deepEqual(vault.chats(), { revision: 0, conversations: [], selectedId: null });
  const saved = await vault.saveChats({ revision: 0, conversations: [conversation()], selectedId: 'chat-1' });
  assert.equal(saved.revision, 1);
  assert.deepEqual((await openPersonalVault(root)).chats(), saved);
  await assert.rejects(vault.saveChats({ revision: 0, conversations: [], selectedId: null }), e => e.status === 409);
  assert.equal(vault.chats().conversations.length, 1);
  const [first, second] = await Promise.allSettled([
    vault.saveChats({ ...saved, conversations: [conversation('first')], selectedId: 'first' }),
    vault.saveChats({ ...saved, conversations: [conversation('second')], selectedId: 'second' })
  ]);
  assert.equal([first, second].filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(vault.chats().revision, 2);
});

test('Неверные данные не повреждают прежние чаты', async t => {
  const { root, vault } = await withVault(t);
  const saved = await vault.saveChats({ revision: 0, conversations: [conversation()], selectedId: 'chat-1' });
  await assert.rejects(vault.saveChats({ ...saved, conversations: [{ ...conversation(), messages: [{ role: 'admin', content: 'x' }] }] }), e => e.status === 400);
  await assert.rejects(vault.saveChats({ ...saved, conversations: [conversation(), conversation()] }), e => e.status === 400);
  assert.deepEqual((await openPersonalVault(root)).chats(), saved);
});

test('Повреждённый индекс не перезаписывается новой пустой историей', async t => {
  const { root } = await withVault(t);
  await mkdir(join(root, 'chats'), { recursive: true });
  await writeFile(join(root, 'chats', 'index.json'), '{broken');
  await assert.rejects(openPersonalVault(root), /Повреждены пользовательские данные/);
  assert.equal(await readFile(join(root, 'chats', 'index.json'), 'utf8'), '{broken');
});

test('Настройки аватара сохраняются отдельно и не принимают произвольные ключи', async t => {
  const { root, vault } = await withVault(t);
  await vault.patchPreferences({ avatar: { size: 180, glow: true } });
  await vault.patchPreferences({ selectedAvatar: 'avatar-1' });
  assert.deepEqual((await openPersonalVault(root)).preferences(), {
    avatar: { size: 180, glow: true }, selectedAvatar: 'avatar-1'
  });
  await assert.rejects(vault.patchPreferences({ apiKey: 'secret-secret' }), e => e.status === 400);
  assert.doesNotMatch(await readFile(join(root, 'ui-preferences.json'), 'utf8'), /secret-secret/);
});

test('Библиотека сохраняет оригинальные байты, ограничивает количество и поддерживает удаление', async t => {
  const { root, vault } = await withVault(t);
  const bytes = Buffer.from('sample-image-bytes');
  const stored = await vault.addAvatar(bytes, 'image/png', 'Кицунэ', 'portrait-1');
  assert.equal(stored.id, 'portrait-1');
  assert.deepEqual((await openPersonalVault(root)).avatars(), [stored]);
  assert.deepEqual((await vault.avatar('portrait-1')).bytes, bytes);
  assert.equal((await vault.addAvatar(bytes, 'image/png', 'Кицунэ', 'portrait-1')).id, 'portrait-1');
  await assert.rejects(vault.addAvatar(bytes, 'application/xml', 'Bad'), e => e.status === 400);
  assert.equal(await vault.removeAvatar('portrait-1'), true);
  assert.equal((await openPersonalVault(root)).avatars().length, 0);
  assert.equal(await vault.avatar('portrait-1'), null);
});
