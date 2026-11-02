import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../gen.mjs';
import { buildOrder, CycleError } from '../lib/graph.mjs';
import { makeFixture, MANIFEST } from './fixture.mjs';

test('build order is topological with manifest-order ties', () => {
  const order = buildOrder([
    { id: 'c', deps: ['a'] },
    { id: 'a', deps: [] },
    { id: 'b', deps: [] },
    { id: 'd', deps: ['c', 'b'] },
  ]);
  assert.deepEqual(order, ['a', 'c', 'b', 'd']);
});

test('a dependency cycle is reported with its path', () => {
  assert.throws(() => buildOrder([{ id: 'a', deps: ['b'] }, { id: 'b', deps: ['c'] }, { id: 'c', deps: ['a'] }]), (e) => {
    assert.ok(e instanceof CycleError);
    assert.deepEqual(e.cycle, ['a', 'b', 'c', 'a']);
    return true;
  });
});

test('generate renders README, BUILD-ORDER, manifest JSON and .env.example from a fixture schema', () => {
  const { kit } = makeFixture();
  const { outputs, errors } = generate(kit);
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(outputs).sort(), ['.env.example', 'BUILD-ORDER.md', 'README.md', 'handoff.manifest.json']);
  const bo = outputs['BUILD-ORDER.md'];
  assert.ok(bo.indexOf('| 1 | ces-tenant') < bo.indexOf('| 2 | ces-shared') && bo.indexOf('| 2 | ces-shared') < bo.indexOf('| 3 | ces-eo'));
  assert.match(bo, /```mermaid\ngraph TD/);
  assert.match(bo, /ces_tenant --> ces_shared/);
  assert.match(bo, /## Legend/);
  const env = outputs['.env.example'];
  assert.match(env, /^CES_EO_AUTH_TOKEN=$/m, 'secret is NAME= with no value');
  assert.match(env, /secrets\.inventory\.yaml \(CES_EO_AUTH_TOKEN\)/);
  assert.match(env, /^EO_PORT=4002$/m, 'required literal default is set');
  assert.match(env, /^# CES_PIPELINE_ROOT=$/m, 'optional prose default is commented and empty');
  assert.match(env, /^# Default: unset = ~\/\.ces$/m);
  const json = JSON.parse(outputs['handoff.manifest.json']);
  assert.equal(json.components.length, 3);
  const readme = outputs['README.md'];
  assert.match(readme, /\| 4002 \| ces-eo \|/);
  assert.match(readme, /## Contracts/);
  assert.match(readme, /## Legend/);
  assert.doesNotMatch(readme, /\d{2}:\d{2}:\d{2}/, 'no timestamps (check (d) would drift)');
});

test('schema missing: .env.example is skipped with a notice, the rest still renders', () => {
  const { kit } = makeFixture({ schema: false });
  const { outputs, errors, notices } = generate(kit);
  assert.deepEqual(errors, []);
  assert.ok(!('.env.example' in outputs));
  assert.ok(notices.some((n) => n.startsWith('schema missing')));
  assert.ok('README.md' in outputs);
});

test('a cycle in the manifest is a generate error', () => {
  const cyclic = MANIFEST.replace('    deps: []\n    ports: []\n    test: "npm test"\n', '    deps: [ces-eo]\n    ports: []\n    test: "npm test"\n');
  const { kit } = makeFixture({ manifest: cyclic });
  const { errors, outputs } = generate(kit);
  assert.equal(Object.keys(outputs).length, 0);
  assert.match(errors.join('\n'), /dependency cycle/);
});

test('invalid manifest fields are reported', () => {
  const bad = MANIFEST.replace('kind: library\n    build: "npm ci && npm run build"', 'kind: widget\n    build: "npm ci && npm run build"');
  const { kit } = makeFixture({ manifest: bad });
  const { errors } = generate(kit);
  assert.match(errors.join('\n'), /"kind" must be one of/);
});
