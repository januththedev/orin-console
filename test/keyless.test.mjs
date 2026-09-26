import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

register(new URL('./_resolve-hook.mjs', import.meta.url));

const { SESSION_TTL_MS } = await import('../src/types.ts');
const { consumeAnonymousCreation, resetLimiter, clientIdFrom } = await import('../src/ratelimit.ts');

test('a session link lives for eight hours', () => {
  assert.equal(SESSION_TTL_MS, 8 * 60 * 60 * 1000);
});

test('keyless creation is limited per client and the window resets', () => {
  resetLimiter();
  const now = 1_000_000;
  const limit = 3;
  for (let i = 0; i < limit; i++) {
    const result = consumeAnonymousCreation('1.2.3.4', limit, 60_000, now);
    assert.equal(result.allowed, true, `request ${i + 1} should be allowed`);
    assert.equal(result.remaining, limit - i - 1);
  }
  const blocked = consumeAnonymousCreation('1.2.3.4', limit, 60_000, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds > 0, 'a refusal must say when to come back');

  // A different client is unaffected.
  assert.equal(consumeAnonymousCreation('5.6.7.8', limit, 60_000, now).allowed, true);

  // After the window, the same client is served again.
  assert.equal(consumeAnonymousCreation('1.2.3.4', limit, 60_000, now + 60_001).allowed, true);
  resetLimiter();
});

test('the limiter cannot be grown without bound by distinct clients', () => {
  resetLimiter();
  for (let i = 0; i < 10_050; i++) consumeAnonymousCreation(`10.0.${Math.floor(i / 256)}.${i % 256}`, 5, 60_000, 1_000_000);
  resetLimiter();
});

test('a caller with no credentials is anonymous; a malformed one is an error', async () => {
  const { optionalOwner } = await import('../src/auth.ts');
  const anonymous = await optionalOwner(new Request('https://console.orinai.org/api/sessions', { method: 'POST' }));
  assert.equal(anonymous, null);
  for (const header of ['Bearer not-a-real-token', 'Basic abcdef', 'Bearer ' + 'a'.repeat(20)]) {
    await assert.rejects(
      () => optionalOwner(new Request('https://console.orinai.org/api/sessions', { method: 'POST', headers: { authorization: header } })),
      /Malformed authorization header/,
      `must refuse ${header}`,
    );
  }
});

test('the client id is taken from the first forwarded hop', () => {
  const req = new Request('https://console.orinai.org/api/sessions', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } });
  assert.equal(clientIdFrom(req), '9.9.9.9');
  assert.equal(clientIdFrom(new Request('https://console.orinai.org/')), 'unknown');
});

test('keyless sessions are capped globally in the database, not just per instance', async () => {
  const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
  assert.match(store, /countActiveSessions/);
  assert.match(store, /expires_at > now\(\)/, 'the cap must count only live sessions');

  const route = await readFile(new URL('../api/sessions/index.ts', import.meta.url), 'utf8');
  assert.match(route, /countActiveSessions\(\) >= MAX_ACTIVE_SESSIONS\(\)/, 'the route must enforce the global cap');
  assert.match(route, /ORIN_CONSOLE_MAX_ACTIVE_SESSIONS/);
});

test('keyless visitors get a terminal but never environment variables', async () => {
  const route = await readFile(new URL('../api/sessions/index.ts', import.meta.url), 'utf8');
  assert.match(route, /Environment variables require a signed-in session/);
  assert.match(route, /env: owner\.kind === 'anon' \? undefined/);
});

test('listing sessions still requires an account', async () => {
  const route = await readFile(new URL('../api/sessions/index.ts', import.meta.url), 'utf8');
  const listBlock = route.slice(0, route.indexOf('if (req.method !=='));
  assert.match(listBlock, /requireOwner/);
});
