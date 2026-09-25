import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Console uses Core introspection instead of raw legacy token tables', async () => {
  const source = await readFile(new URL('../src/auth.ts', import.meta.url), 'utf8');
  assert.match(source, /ORIN_CORE_URL/);
  assert.match(source, /session\/introspect/);
  assert.match(source, /mcp\/verify/);
  assert.doesNotMatch(source, /SELECT revoked FROM sessions|orin_mcp_/);
});
test('sandbox capture preserves ANSI and service persists ports', async () => {
  const sandbox = await readFile(new URL('../src/sandbox.ts', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/service.ts', import.meta.url), 'utf8');
  const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
  assert.match(sandbox, /capture-pane', '-e'/);
  assert.match(service, /createSandbox\(name, env, session\.ports\)/);
  assert.match(service, /portUrls/);
  assert.match(store, /ports/);
});
test('share refuses terminal mode for sessions with injected environment', async () => {
  const service = await readFile(new URL('../src/service.ts', import.meta.url), 'utf8');
  assert.match(service, /envNames\.length/);
  assert.match(service, /Terminal sharing is disabled/);
});
test('browser does not persist Console bearer tokens', async () => {
  const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(source, /sessionStorage\.getItem\('orin_token'\)/);
  assert.doesNotMatch(source, /localStorage\.(getItem|setItem|removeItem)\('orin_token'/);
});
