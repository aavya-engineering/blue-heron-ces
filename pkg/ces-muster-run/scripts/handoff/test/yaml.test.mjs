import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../lib/yaml.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'handoff');

test('block mappings, sequences and scalars', () => {
  const doc = parseYaml(`# comment
a: 1
b: "two # not a comment"
c: 'it''s'
d: plain text # trailing comment
e: true
f: ~
g:
  - x
  - 2.5
h:
- id: one
  deps: []
- id: two
  deps: [one]
`);
  assert.deepEqual(doc, {
    a: 1, b: 'two # not a comment', c: "it's", d: 'plain text', e: true, f: null,
    g: ['x', 2.5],
    h: [{ id: 'one', deps: [] }, { id: 'two', deps: ['one'] }],
  });
});

test('flow collections nest and may span lines', () => {
  const doc = parseYaml(`release: { id: "r-1", cut: "2026-11-01", status: draft }
ports:
  - { port: 4002, service: "EO, the server", bind: "0.0.0.0", configKey: EO_PORT }
multi: [ a,
  b, { k: [1, 2] } ]
url: { u: http://x:1/y }
`);
  assert.deepEqual(doc.release, { id: 'r-1', cut: '2026-11-01', status: 'draft' });
  assert.deepEqual(doc.ports, [{ port: 4002, service: 'EO, the server', bind: '0.0.0.0', configKey: 'EO_PORT' }]);
  assert.deepEqual(doc.multi, ['a', 'b', { k: [1, 2] }]);
  assert.deepEqual(doc.url, { u: 'http://x:1/y' });
});

test('double-quoted escapes and block scalars', () => {
  const doc = parseYaml(`q: "a\\"b\\\\c\\n\\u0041"
lit: |
  line one
  line two
fold: >-
  folded
  text
next: 1
`);
  assert.equal(doc.q, 'a"b\\c\nA');
  assert.equal(doc.lit, 'line one\nline two\n');
  assert.equal(doc.fold, 'folded text');
  assert.equal(doc.next, 1);
});

test('errors: duplicate key, tab indentation, unterminated flow', () => {
  assert.throws(() => parseYaml('a: 1\na: 2\n'), /duplicate key/);
  assert.throws(() => parseYaml('a:\n\tb: 1\n'), /tab/);
  assert.throws(() => parseYaml('a: [1, 2\n'), /unterminated/);
});

test('the real kit YAML files parse', () => {
  for (const f of ['handoff.manifest.yaml', 'contracts.yaml', 'config.schema.yaml', 'secrets.inventory.yaml']) {
    const p = path.join(KIT, f);
    if (!fs.existsSync(p)) continue;
    const doc = parseYaml(fs.readFileSync(p, 'utf8'));
    assert.equal(doc.schemaVersion, 1, f);
  }
});
