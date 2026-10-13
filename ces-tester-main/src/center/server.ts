// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * CC-3/CC-4/CC-5 — Command Center HTTP server.
 *
 * One `node:http` server on 127.0.0.1:4600 (configurable). Follows the house
 * pattern from `slides-server.ts`: no framework, plain `node:http`.
 *
 * GET  /                   — the page (self-contained HTML)
 * GET  /ces-ui.css         — shared CES stylesheet (read-only from ces-shared)
 * GET  /ces-theme-toggle.js — shared CES theme toggle
 * GET  /ces-logo.svg       — shared CES logo
 *
 * GET  /api/catalog        — full catalog JSON
 * GET  /api/runnables/:id  — single runnable detail
 * GET  /api/runs           — run history (most recent first)
 * GET  /api/runs/:runId/log — log file content
 * GET  /api/coverage       — coverage stats
 *
 * POST /api/launch         — start a run (CC-4)
 * GET  /api/events         — SSE stream for the active run's log
 * POST /api/runs/:runId/stop — kill the active run (CC-4)
 *
 * POST /api/retire/:id     — retire a runnable (CC-5)
 * POST /api/unretire/:id   — unretire
 * POST /api/delete/:id     — delete (archive) a file-backed runnable
 * POST /api/restore/:id    — restore from archive
 * POST /api/delete-run/:runId — move run output to trash
 * POST /api/restore-run/:runId — restore from trash
 * POST /api/duplicate/:id  — duplicate a file-backed runnable
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import type { Runnable, RunRecord, AuditEntry, MetaOverlay, RunMode } from '../catalog/types.js';
import {
  readRunIndex,
  appendRunRecord,
  updateRunRecord,
  RUN_ID_ENV,
  LAUNCHED_BY_ENV,
  statusFromExit,
} from '../catalog/run-index.js';
import { buildCatalog, loadMetaOverlay, saveMetaOverlay } from '../catalog/discover.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveRun {
  runId: string;
  runnableId: string;
  mode: RunMode;
  proc: child_process.ChildProcess;
  logPath: string;
  logStream: fs.WriteStream;
  sseClients: Set<http.ServerResponse>;
}

export interface CenterServerOptions {
  port: number;
  projectRoot: string;
}

// ---------------------------------------------------------------------------
// CES ports to check before launch
// ---------------------------------------------------------------------------

const CES_PORTS = [3000, 3001, 4002, 4173, 4390, 4500];

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('node:net') as typeof import('node:net');
    const srv = net.createServer();
    srv.once('error', () => resolve(true));   // in use
    srv.once('listening', () => { srv.close(); resolve(false); }); // free
    srv.listen(port, '127.0.0.1');
  });
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

async function appendAudit(
  projectRoot: string,
  entry: AuditEntry,
): Promise<void> {
  const auditPath = path.join(projectRoot, 'catalog', 'audit.jsonl');
  await fsp.mkdir(path.dirname(auditPath), { recursive: true });
  await fsp.appendFile(auditPath, JSON.stringify(entry) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Security: localhost-only origin check
// ---------------------------------------------------------------------------

function isLocalhostOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers['origin'] ?? '';
  const host = req.headers['host'] ?? '';
  const localhostPattern = /^(https?:\/\/)?(localhost|127\.0\.0\.1|::1)(:\d+)?$/;
  // No origin header (non-browser or same-origin) is OK
  if (!origin) return true;
  return localhostPattern.test(origin) && (
    !host || /^(localhost|127\.0\.0\.1|::1)(:\d+)?$/.test(host)
  );
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function isSafePath(projectRoot: string, targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(projectRoot);
  return resolved.startsWith(root + path.sep) || resolved === root;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function send404(res: http.ServerResponse, msg = 'Not found'): void {
  sendJson(res, { error: msg }, 404);
}

function send400(res: http.ServerResponse, msg: string): void {
  sendJson(res, { error: msg }, 400);
}

function send409(res: http.ServerResponse, msg: string, data?: Record<string, unknown>): void {
  sendJson(res, { error: msg, ...data }, 409);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// The page HTML
// ---------------------------------------------------------------------------

function buildPageHtml(projectRoot: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CES Command Center</title>
<link rel="stylesheet" href="/ces-ui.css">
<style>
:root {
  --cc-bg: #f8f9fa;
  --cc-card: #fff;
  --cc-border: #dee2e6;
  --cc-text: #212529;
  --cc-muted: #6c757d;
  --cc-accent: #0d6efd;
  --cc-pass: #198754;
  --cc-fail: #dc3545;
  --cc-warn: #fd7e14;
  --cc-running: #0dcaf0;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --cc-bg: #1a1a2e;
    --cc-card: #16213e;
    --cc-border: #334155;
    --cc-text: #e2e8f0;
    --cc-muted: #94a3b8;
    --cc-accent: #60a5fa;
    --cc-pass: #4ade80;
    --cc-fail: #f87171;
    --cc-warn: #fb923c;
    --cc-running: #22d3ee;
  }
}
:root[data-theme="dark"] {
  --cc-bg: #1a1a2e;
  --cc-card: #16213e;
  --cc-border: #334155;
  --cc-text: #e2e8f0;
  --cc-muted: #94a3b8;
  --cc-accent: #60a5fa;
  --cc-pass: #4ade80;
  --cc-fail: #f87171;
  --cc-warn: #fb923c;
  --cc-running: #22d3ee;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: var(--cc-bg); color: var(--cc-text); padding: 16px; }
h1 { font-size: 1.5rem; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }
h1 img { height: 32px; }
.tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 2px solid var(--cc-border); }
.tab { padding: 8px 16px; cursor: pointer; border: none; background: none; color: var(--cc-muted); font-size: 0.9rem; border-bottom: 2px solid transparent; margin-bottom: -2px; }
.tab.active { color: var(--cc-accent); border-bottom-color: var(--cc-accent); font-weight: 600; }
.search { width: 100%; padding: 8px 12px; border: 1px solid var(--cc-border); border-radius: 6px; background: var(--cc-card); color: var(--cc-text); font-size: 0.9rem; margin-bottom: 12px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.filters select { padding: 4px 8px; border: 1px solid var(--cc-border); border-radius: 4px; background: var(--cc-card); color: var(--cc-text); font-size: 0.85rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th { text-align: left; padding: 8px; border-bottom: 2px solid var(--cc-border); color: var(--cc-muted); font-weight: 600; }
td { padding: 8px; border-bottom: 1px solid var(--cc-border); vertical-align: top; }
tr:hover td { background: color-mix(in srgb, var(--cc-accent) 5%, transparent); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
.badge-pass { background: color-mix(in srgb, var(--cc-pass) 15%, transparent); color: var(--cc-pass); }
.badge-fail { background: color-mix(in srgb, var(--cc-fail) 15%, transparent); color: var(--cc-fail); }
.badge-running { background: color-mix(in srgb, var(--cc-running) 15%, transparent); color: var(--cc-running); }
.badge-unknown { background: color-mix(in srgb, var(--cc-muted) 15%, transparent); color: var(--cc-muted); }
.badge-aborted { background: color-mix(in srgb, var(--cc-warn) 15%, transparent); color: var(--cc-warn); }
.chip { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; background: color-mix(in srgb, var(--cc-accent) 12%, transparent); color: var(--cc-accent); margin: 1px; }
.btn { padding: 4px 12px; border: 1px solid var(--cc-border); border-radius: 4px; background: var(--cc-card); color: var(--cc-text); cursor: pointer; font-size: 0.8rem; }
.btn:hover { border-color: var(--cc-accent); }
.btn-primary { background: var(--cc-accent); color: #fff; border-color: var(--cc-accent); }
.btn-danger { background: var(--cc-fail); color: #fff; border-color: var(--cc-fail); }
.detail { background: var(--cc-card); border: 1px solid var(--cc-border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.detail h2 { font-size: 1.1rem; margin-bottom: 8px; }
.detail-row { display: flex; gap: 8px; margin-bottom: 4px; }
.detail-label { color: var(--cc-muted); min-width: 120px; font-size: 0.85rem; }
.detail-value { font-size: 0.85rem; }
.cmd-copy { font-family: monospace; background: var(--cc-bg); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer; user-select: all; border: 1px solid var(--cc-border); display: inline-block; }
.log-view { background: #0d1117; color: #c9d1d9; font-family: monospace; font-size: 0.8rem; padding: 12px; border-radius: 6px; max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--cc-card); border-radius: 8px; padding: 24px; min-width: 400px; max-width: 600px; }
.modal h3 { margin-bottom: 12px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.hidden { display: none !important; }
#active-run-bar { background: color-mix(in srgb, var(--cc-running) 10%, transparent); border: 1px solid var(--cc-running); border-radius: 8px; padding: 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px; }
#active-run-bar .spinner { width: 16px; height: 16px; border: 2px solid var(--cc-running); border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
footer { margin-top: 24px; text-align: center; color: var(--cc-muted); font-size: 0.75rem; }
</style>
</head>
<body>
<h1><img src="/ces-logo.svg" alt="" onerror="this.style.display='none'"> CES Command Center</h1>
<script src="/ces-theme-toggle.js" defer></script>

<div class="tabs">
  <button class="tab active" data-tab="catalog">Catalog</button>
  <button class="tab" data-tab="runs">Runs</button>
  <button class="tab" data-tab="coverage">Coverage</button>
</div>

<div id="active-run-bar" class="hidden">
  <div class="spinner"></div>
  <span id="active-run-label"></span>
  <button class="btn btn-danger" id="stop-run-btn">Stop</button>
  <button class="btn" id="show-log-btn">Log</button>
</div>

<!-- Catalog tab -->
<div id="tab-catalog">
  <input class="search" id="search" placeholder="Search runnables..." />
  <div class="filters">
    <select id="filter-kind"><option value="">All kinds</option><option>scenario</option><option>deck</option><option>act</option><option>pipeline</option></select>
    <select id="filter-mode"><option value="">All modes</option><option>test</option><option>demo</option></select>
    <select id="filter-status"><option value="">All statuses</option><option>pass</option><option>fail</option><option>running</option><option>unknown</option></select>
    <label style="font-size:0.85rem;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="filter-retired"> Show retired</label>
  </div>
  <table id="catalog-table">
    <thead><tr><th>Name</th><th>Kind</th><th>Summary</th><th>Modes</th><th>Modules</th><th>Last Run</th><th>Actions</th></tr></thead>
    <tbody id="catalog-body"></tbody>
  </table>
</div>

<!-- Detail panel (shown in place of the table when a runnable is selected) -->
<div id="detail-panel" class="hidden"></div>

<!-- Runs tab -->
<div id="tab-runs" class="hidden">
  <div class="filters">
    <select id="runs-filter-status"><option value="">All statuses</option><option>pass</option><option>fail</option><option>running</option><option>aborted</option><option>unknown</option></select>
  </div>
  <table>
    <thead><tr><th>Run ID</th><th>Runnable</th><th>Mode</th><th>Status</th><th>Started</th><th>Duration</th><th>Actions</th></tr></thead>
    <tbody id="runs-body"></tbody>
  </table>
</div>

<!-- Coverage tab -->
<div id="tab-coverage" class="hidden">
  <div id="coverage-content"></div>
</div>

<!-- Launch confirmation modal -->
<div id="launch-modal" class="modal-bg hidden">
  <div class="modal">
    <h3>Launch Run</h3>
    <p id="launch-desc"></p>
    <div class="cmd-copy" id="launch-cmd"></div>
    <div class="modal-actions">
      <button class="btn" id="launch-cancel">Cancel</button>
      <button class="btn btn-primary" id="launch-confirm">Launch</button>
    </div>
  </div>
</div>

<!-- Log modal -->
<div id="log-modal" class="modal-bg hidden">
  <div class="modal" style="min-width:700px;max-width:90vw;">
    <h3>Run Log</h3>
    <div class="log-view" id="log-content"></div>
    <div class="modal-actions">
      <button class="btn" id="log-close">Close</button>
    </div>
  </div>
</div>

<footer>CES Command Center · ces-tester · localhost only</footer>

<script>
const API = '';
let catalog = [];
let runs = [];
let activeRunId = null;
let evtSource = null;

// --- Tabs ---
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('tab-catalog').classList.toggle('hidden', t.dataset.tab !== 'catalog');
  document.getElementById('tab-runs').classList.toggle('hidden', t.dataset.tab !== 'runs');
  document.getElementById('tab-coverage').classList.toggle('hidden', t.dataset.tab !== 'coverage');
  document.getElementById('detail-panel').classList.add('hidden');
  if (t.dataset.tab === 'runs') loadRuns();
  if (t.dataset.tab === 'coverage') loadCoverage();
}));

// --- Catalog ---
async function loadCatalog() {
  const includeRetired = document.getElementById('filter-retired').checked;
  const url = API + '/api/catalog' + (includeRetired ? '?includeRetired=1' : '');
  catalog = await fetch(url).then(r => r.json());
  renderCatalog();
}

function renderCatalog() {
  const search = document.getElementById('search').value.toLowerCase();
  const kind = document.getElementById('filter-kind').value;
  const mode = document.getElementById('filter-mode').value;
  const status = document.getElementById('filter-status').value;

  const tbody = document.getElementById('catalog-body');
  tbody.innerHTML = '';
  for (const r of catalog) {
    if (search && !r.id.toLowerCase().includes(search) && !r.summary.toLowerCase().includes(search)) continue;
    if (kind && r.kind !== kind) continue;
    if (mode && !r.modes.some(m => m.mode === mode)) continue;
    if (status && r.lastRunStatus !== status) continue;

    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => showDetail(r.id));
    const modes = r.modes.map(m => m.mode).filter((v,i,a) => a.indexOf(v) === i).join(', ');
    const modules = r.modules.map(m => '<span class="chip">' + esc(m) + '</span>').join(' ');
    const lastBadge = r.lastRunStatus ? statusBadge(r.lastRunStatus) : '<span class="badge badge-unknown">—</span>';
    const lastTime = r.lastRunTime ? relTime(r.lastRunTime) : '';

    tr.innerHTML = '<td>' + esc(r.name) + (r.retired ? ' <span class="badge badge-aborted">retired</span>' : '') + '</td>' +
      '<td><span class="chip">' + esc(r.kind) + '</span></td>' +
      '<td>' + esc(r.summary) + '</td>' +
      '<td>' + esc(modes) + '</td>' +
      '<td>' + modules + '</td>' +
      '<td>' + lastBadge + ' ' + esc(lastTime) + '</td>' +
      '<td>' + r.modes.map(m =>
        '<button class="btn" onclick="event.stopPropagation();launchDialog(\\'' + esc(r.id) + '\\',\\'' + esc(m.mode) + '\\')">' + esc(m.label || m.mode) + '</button>'
      ).join(' ') + '</td>';
    tbody.appendChild(tr);
  }
}

async function showDetail(id) {
  const r = await fetch(API + '/api/runnables/' + encodeURIComponent(id)).then(r => r.json());
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');

  let html = '<div class="detail"><h2>' + esc(r.name) + '</h2>';
  html += '<div class="detail-row"><span class="detail-label">Kind</span><span class="detail-value"><span class="chip">' + esc(r.kind) + '</span></span></div>';
  html += '<div class="detail-row"><span class="detail-label">Summary</span><span class="detail-value">' + esc(r.summary) + '</span></div>';
  if (r.notes) html += '<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">' + esc(r.notes) + '</span></div>';
  if (r.sourcePath) html += '<div class="detail-row"><span class="detail-label">Source</span><span class="detail-value">' + esc(r.sourcePath) + '</span></div>';

  html += '<div class="detail-row"><span class="detail-label">Commands</span><div>';
  for (const m of r.modes) {
    html += '<div style="margin-bottom:4px"><strong>' + esc(m.label || m.mode) + ':</strong> <span class="cmd-copy" title="Click to copy" onclick="navigator.clipboard.writeText(this.textContent)">node bin/ces-tester.mjs ' + esc(m.argv.join(' ')) + '</span></div>';
  }
  html += '</div></div>';

  if (r.usesActs.length) html += '<div class="detail-row"><span class="detail-label">Uses acts</span><span class="detail-value">' + r.usesActs.map(a => '<span class="chip">' + esc(a) + '</span>').join(' ') + '</span></div>';
  if (r.presentedInDecks.length) html += '<div class="detail-row"><span class="detail-label">In decks</span><span class="detail-value">' + r.presentedInDecks.map(d => '<span class="chip">' + esc(d) + '</span>').join(' ') + '</span></div>';
  if (r.testFiles.length) html += '<div class="detail-row"><span class="detail-label">Test files</span><span class="detail-value">' + r.testFiles.map(f => esc(f)).join(', ') + '</span></div>';
  if (r.modules.length) html += '<div class="detail-row"><span class="detail-label">Modules</span><span class="detail-value">' + r.modules.map(m => '<span class="chip">' + esc(m) + '</span>').join(' ') + '</span></div>';

  // Last 20 runs
  if (r.recentRuns && r.recentRuns.length) {
    html += '<h3 style="margin-top:12px">Recent Runs</h3><table><thead><tr><th>Run ID</th><th>Status</th><th>Started</th><th>Duration</th></tr></thead><tbody>';
    for (const run of r.recentRuns) {
      const dur = run.endedAt ? Math.round((new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) / 1000) + 's' : '—';
      html += '<tr><td>' + esc(run.runId) + '</td><td>' + statusBadge(run.status) + '</td><td>' + esc(relTime(run.startedAt)) + '</td><td>' + esc(dur) + '</td></tr>';
    }
    html += '</tbody></table>';
  }

  // Actions
  html += '<div style="margin-top:12px;display:flex;gap:8px">';
  html += '<button class="btn" onclick="document.getElementById(\\'detail-panel\\').classList.add(\\'hidden\\')">← Back</button>';
  if (!r.retired) html += '<button class="btn" onclick="doAction(\\'retire\\',\\'' + esc(r.id) + '\\')">Retire</button>';
  else html += '<button class="btn" onclick="doAction(\\'unretire\\',\\'' + esc(r.id) + '\\')">Unretire</button>';
  if (r.kind === 'scenario' || r.kind === 'deck') {
    html += '<button class="btn btn-danger" onclick="doAction(\\'delete\\',\\'' + esc(r.id) + '\\')">Archive</button>';
    html += '<button class="btn" onclick="promptDuplicate(\\'' + esc(r.id) + '\\')">Duplicate</button>';
  }
  html += '</div>';

  html += '</div>';
  panel.innerHTML = html;
}

// --- Runs ---
async function loadRuns() {
  runs = await fetch(API + '/api/runs').then(r => r.json());
  renderRuns();
}

function renderRuns() {
  const status = document.getElementById('runs-filter-status').value;
  const tbody = document.getElementById('runs-body');
  tbody.innerHTML = '';
  for (const r of runs) {
    if (status && r.status !== status) continue;
    const dur = r.endedAt ? Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000) + 's' : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(r.runId) + '</td>' +
      '<td>' + esc(r.runnableId) + '</td>' +
      '<td>' + esc(r.mode) + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
      '<td>' + esc(relTime(r.startedAt)) + '</td>' +
      '<td>' + esc(dur) + '</td>' +
      '<td>' +
        (r.logPath ? '<button class="btn" onclick="showLog(\\'' + esc(r.runId) + '\\')">Log</button> ' : '') +
        '<button class="btn btn-danger" onclick="doAction(\\'delete-run\\',\\'' + esc(r.runId) + '\\')">Trash</button>' +
      '</td>';
    tbody.appendChild(tr);
  }
}

// --- Coverage ---
async function loadCoverage() {
  const data = await fetch(API + '/api/coverage').then(r => r.json());
  const el = document.getElementById('coverage-content');
  let html = '<div class="detail">';
  html += '<h2>Coverage Overview</h2>';

  if (data.actsInNoDecks.length) {
    html += '<h3 style="margin-top:8px">Acts in no deck</h3><ul>';
    data.actsInNoDecks.forEach(a => html += '<li>' + esc(a) + '</li>');
    html += '</ul>';
  }
  if (data.actsWithNoTest.length) {
    html += '<h3 style="margin-top:8px">Acts with no test file</h3><ul>';
    data.actsWithNoTest.forEach(a => html += '<li>' + esc(a) + '</li>');
    html += '</ul>';
  }
  if (data.lastStatusMix) {
    html += '<h3 style="margin-top:8px">Last status by kind</h3><table><thead><tr><th>Kind</th><th>Pass</th><th>Fail</th><th>Unknown</th><th>Total</th></tr></thead><tbody>';
    for (const [kind, mix] of Object.entries(data.lastStatusMix)) {
      const m = mix;
      html += '<tr><td>' + esc(kind) + '</td><td>' + (m.pass||0) + '</td><td>' + (m.fail||0) + '</td><td>' + (m.unknown||0) + '</td><td>' + (m.total||0) + '</td></tr>';
    }
    html += '</tbody></table>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// --- Launch ---
let pendingLaunch = null;
function launchDialog(runnableId, mode) {
  const r = catalog.find(x => x.id === runnableId);
  if (!r) return;
  const modeSpec = r.modes.find(m => m.mode === mode);
  if (!modeSpec) return;
  pendingLaunch = { runnableId, mode };
  document.getElementById('launch-desc').textContent = r.summary + ' (' + mode + ')';
  document.getElementById('launch-cmd').textContent = 'node bin/ces-tester.mjs ' + modeSpec.argv.join(' ');
  document.getElementById('launch-modal').classList.remove('hidden');
}
document.getElementById('launch-cancel').addEventListener('click', () => {
  document.getElementById('launch-modal').classList.add('hidden');
  pendingLaunch = null;
});
document.getElementById('launch-confirm').addEventListener('click', async () => {
  if (!pendingLaunch) return;
  document.getElementById('launch-modal').classList.add('hidden');
  const resp = await fetch(API + '/api/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pendingLaunch),
  });
  if (resp.status === 409) {
    const d = await resp.json();
    alert('A run is already active: ' + (d.activeRunId || ''));
    return;
  }
  const d = await resp.json();
  if (d.runId) {
    activeRunId = d.runId;
    connectSSE();
    updateActiveBar();
  }
  pendingLaunch = null;
});

// --- SSE ---
function connectSSE() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource(API + '/api/events');
  const logEl = document.getElementById('log-content');
  evtSource.addEventListener('log', (e) => {
    logEl.textContent += e.data + '\\n';
    logEl.scrollTop = logEl.scrollHeight;
  });
  evtSource.addEventListener('done', (e) => {
    activeRunId = null;
    updateActiveBar();
    evtSource.close();
    evtSource = null;
    loadCatalog();
    loadRuns();
  });
}

function updateActiveBar() {
  const bar = document.getElementById('active-run-bar');
  if (activeRunId) {
    bar.classList.remove('hidden');
    document.getElementById('active-run-label').textContent = 'Running: ' + activeRunId;
  } else {
    bar.classList.add('hidden');
  }
}

document.getElementById('stop-run-btn').addEventListener('click', async () => {
  if (!activeRunId) return;
  await fetch(API + '/api/runs/' + encodeURIComponent(activeRunId) + '/stop', { method: 'POST' });
});

document.getElementById('show-log-btn').addEventListener('click', () => {
  document.getElementById('log-modal').classList.remove('hidden');
});

// --- Log modal ---
async function showLog(runId) {
  const resp = await fetch(API + '/api/runs/' + encodeURIComponent(runId) + '/log');
  const text = await resp.text();
  document.getElementById('log-content').textContent = text;
  document.getElementById('log-modal').classList.remove('hidden');
}
document.getElementById('log-close').addEventListener('click', () => {
  document.getElementById('log-modal').classList.add('hidden');
});

// --- Actions ---
async function doAction(action, id) {
  if (action === 'delete' || action === 'delete-run') {
    if (!confirm('Archive ' + id + '? (Can be restored)')) return;
  }
  const resp = await fetch(API + '/api/' + action + '/' + encodeURIComponent(id), { method: 'POST' });
  const d = await resp.json();
  if (!resp.ok) alert(d.error || 'Failed');
  loadCatalog();
  loadRuns();
}

function promptDuplicate(id) {
  const newName = prompt('New name for the duplicate:');
  if (!newName) return;
  fetch(API + '/api/duplicate/' + encodeURIComponent(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName }),
  }).then(r => r.json()).then(d => {
    if (d.error) alert(d.error);
    loadCatalog();
  });
}

// --- Helpers ---
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function statusBadge(s) { return '<span class="badge badge-' + (s||'unknown') + '">' + esc(s||'unknown') + '</span>'; }
function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.floor(ms/60000) + 'm ago';
  if (ms < 86400000) return Math.floor(ms/3600000) + 'h ago';
  return Math.floor(ms/86400000) + 'd ago';
}

// --- Filters ---
document.getElementById('search').addEventListener('input', renderCatalog);
document.getElementById('filter-kind').addEventListener('change', renderCatalog);
document.getElementById('filter-mode').addEventListener('change', renderCatalog);
document.getElementById('filter-status').addEventListener('change', renderCatalog);
document.getElementById('filter-retired').addEventListener('change', loadCatalog);
document.getElementById('runs-filter-status').addEventListener('change', renderRuns);

// --- Init ---
loadCatalog();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startCenterServer(opts: CenterServerOptions): Promise<http.Server> {
  const { port, projectRoot } = opts;
  const runsRoot = path.join(projectRoot, 'runs');
  const sharedUiDir = path.resolve(projectRoot, '..', 'ces-shared', 'ui');

  let activeRun: ActiveRun | null = null;

  // Enrich catalog entries with last run status
  async function enrichedCatalog(includeRetired: boolean) {
    const cat = await buildCatalog({ projectRoot, includeRetired });
    const runRecords = await readRunIndex(runsRoot);

    // Index: runnableId -> most recent run
    const lastRun = new Map<string, RunRecord>();
    for (const r of runRecords) {
      const existing = lastRun.get(r.runnableId);
      if (!existing || r.startedAt > existing.startedAt) {
        lastRun.set(r.runnableId, r);
      }
    }

    return cat.map((r) => {
      const lr = lastRun.get(r.id);
      return {
        ...r,
        lastRunStatus: lr?.status ?? null,
        lastRunTime: lr?.startedAt ?? null,
      };
    });
  }

  // Get recent runs for a runnable
  async function recentRunsFor(runnableId: string, limit = 20): Promise<RunRecord[]> {
    const all = await readRunIndex(runsRoot);
    return all
      .filter((r) => r.runnableId === runnableId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // CORS for localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }

    // Mutating endpoints: POST only + localhost origin check
    if (req.method === 'POST') {
      if (!isLocalhostOrigin(req)) {
        sendJson(res, { error: 'Forbidden: non-localhost origin' }, 403);
        return;
      }
    }

    try {
      // --- Static assets ---
      if (pathname === '/' || pathname === '/index.html') {
        const html = buildPageHtml(projectRoot);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (pathname === '/ces-ui.css') {
        return serveFile(res, path.join(sharedUiDir, 'ces-ui.css'), 'text/css');
      }
      if (pathname === '/ces-theme-toggle.js') {
        return serveFile(res, path.join(sharedUiDir, 'ces-theme-toggle.js'), 'text/javascript');
      }
      if (pathname === '/ces-logo.svg') {
        return serveFile(res, path.join(sharedUiDir, '..', 'assets', 'ces-logo.svg'), 'image/svg+xml');
      }

      // --- API: Catalog ---
      if (pathname === '/api/catalog' && req.method === 'GET') {
        const includeRetired = url.searchParams.get('includeRetired') === '1';
        const data = await enrichedCatalog(includeRetired);
        sendJson(res, data);
        return;
      }

      // --- API: Single runnable ---
      const runnableMatch = pathname.match(/^\/api\/runnables\/(.+)$/);
      if (runnableMatch && req.method === 'GET') {
        const id = decodeURIComponent(runnableMatch[1]);
        const cat = await buildCatalog({ projectRoot, includeRetired: true });
        const r = cat.find((x) => x.id === id);
        if (!r) { send404(res, `Runnable not found: ${id}`); return; }
        const recent = await recentRunsFor(id);
        sendJson(res, { ...r, recentRuns: recent });
        return;
      }

      // --- API: Runs ---
      if (pathname === '/api/runs' && req.method === 'GET') {
        const records = await readRunIndex(runsRoot);
        records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        sendJson(res, records);
        return;
      }

      // --- API: Run log ---
      const logMatch = pathname.match(/^\/api\/runs\/(.+)\/log$/);
      if (logMatch && req.method === 'GET') {
        const runId = decodeURIComponent(logMatch[1]);
        const records = await readRunIndex(runsRoot);
        const rec = records.find((r) => r.runId === runId);
        if (!rec?.logPath) { send404(res, 'No log for this run'); return; }
        return serveFile(res, rec.logPath, 'text/plain');
      }

      // --- API: Coverage ---
      if (pathname === '/api/coverage' && req.method === 'GET') {
        const cat = await buildCatalog({ projectRoot, includeRetired: true });
        const records = await readRunIndex(runsRoot);

        const actsInNoDecks = cat
          .filter((r) => r.kind === 'act' && r.presentedInDecks.length === 0)
          .map((r) => r.name);
        const actsWithNoTest = cat
          .filter((r) => r.kind === 'act' && r.testFiles.length === 0)
          .map((r) => r.name);

        // Last status by kind
        const lastRun = new Map<string, RunRecord>();
        for (const r of records) {
          const existing = lastRun.get(r.runnableId);
          if (!existing || r.startedAt > existing.startedAt) {
            lastRun.set(r.runnableId, r);
          }
        }
        const statusMix: Record<string, Record<string, number>> = {};
        for (const r of cat) {
          if (!statusMix[r.kind]) statusMix[r.kind] = { pass: 0, fail: 0, unknown: 0, total: 0 };
          const lr = lastRun.get(r.id);
          const s = lr?.status ?? 'unknown';
          statusMix[r.kind][s] = (statusMix[r.kind][s] ?? 0) + 1;
          statusMix[r.kind].total++;
        }

        sendJson(res, { actsInNoDecks, actsWithNoTest, lastStatusMix: statusMix });
        return;
      }

      // --- API: Launch (CC-4) ---
      if (pathname === '/api/launch' && req.method === 'POST') {
        if (activeRun) {
          send409(res, 'A run is already active', { activeRunId: activeRun.runId });
          return;
        }

        const body = await readBody(req);
        const runnableId = String(body.runnableId ?? '');
        const mode = String(body.mode ?? 'test') as RunMode;

        const cat = await buildCatalog({ projectRoot, includeRetired: true });
        const r = cat.find((x) => x.id === runnableId);
        if (!r) { send400(res, `Unknown runnable: ${runnableId}`); return; }

        const modeSpec = r.modes.find((m) => m.mode === mode);
        if (!modeSpec) { send400(res, `Runnable ${runnableId} does not support mode ${mode}`); return; }

        // Check dist/ freshness
        try {
          const distStat = await fsp.stat(path.join(projectRoot, 'dist'));
          const srcStat = await fsp.stat(path.join(projectRoot, 'src'));
          if (srcStat.mtimeMs > distStat.mtimeMs + 5000) {
            send400(res, 'dist/ appears stale — run npm run build first');
            return;
          }
        } catch {
          send400(res, 'dist/ not found — run npm run build first');
          return;
        }

        // Check CES ports
        const busyPorts: number[] = [];
        for (const p of CES_PORTS) {
          if (await checkPort(p)) busyPorts.push(p);
        }

        const runId = `center-${Date.now()}`;
        const logPath = path.join(runsRoot, runId, 'center.log');
        await fsp.mkdir(path.dirname(logPath), { recursive: true });
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        if (busyPorts.length) {
          logStream.write(`[center] Warning: CES ports in use: ${busyPorts.join(', ')}\n`);
        }

        const argv = ['bin/ces-tester.mjs', ...modeSpec.argv];
        const proc = child_process.spawn('node', argv, {
          cwd: projectRoot,
          env: {
            ...process.env,
            [RUN_ID_ENV]: runId,
            [LAUNCHED_BY_ENV]: 'center',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
        });

        const sseClients = new Set<http.ServerResponse>();
        activeRun = { runId, runnableId, mode, proc, logPath, logStream, sseClients };

        const broadcast = (line: string): void => {
          logStream.write(line + '\n');
          for (const client of sseClients) {
            client.write(`event: log\ndata: ${line}\n\n`);
          }
        };

        proc.stdout?.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString('utf8').split('\n')) {
            if (line) broadcast(line);
          }
        });
        proc.stderr?.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString('utf8').split('\n')) {
            if (line) broadcast(`[stderr] ${line}`);
          }
        });

        proc.on('close', async (code) => {
          const status = code === null ? 'aborted' : statusFromExit(code);
          const endedAt = new Date().toISOString();

          // Record in index
          const record: RunRecord = {
            runId,
            runnableId,
            mode,
            argv: [...modeSpec.argv],
            startedAt: new Date().toISOString(), // approximate — should be from launch time
            endedAt,
            exitCode: code ?? undefined,
            status,
            outputDir: path.dirname(logPath),
            logPath,
            launchedBy: 'center',
            pid: proc.pid,
          };
          try { await appendRunRecord(runsRoot, record); } catch { /* non-fatal */ }

          // Notify SSE clients
          for (const client of sseClients) {
            client.write(`event: done\ndata: ${JSON.stringify({ runId, status })}\n\n`);
            client.end();
          }
          logStream.end();
          activeRun = null;
        });

        sendJson(res, { runId, runnableId, mode, busyPorts });
        return;
      }

      // --- API: SSE events ---
      if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        if (activeRun) {
          activeRun.sseClients.add(res);
          req.on('close', () => { activeRun?.sseClients.delete(res); });
        } else {
          res.write(`event: done\ndata: ${JSON.stringify({ runId: null, status: 'idle' })}\n\n`);
          res.end();
        }
        return;
      }

      // --- API: Stop run ---
      const stopMatch = pathname.match(/^\/api\/runs\/(.+)\/stop$/);
      if (stopMatch && req.method === 'POST') {
        const runId = decodeURIComponent(stopMatch[1]);
        if (!activeRun || activeRun.runId !== runId) {
          send404(res, 'No active run with that ID');
          return;
        }
        const pid = activeRun.proc.pid;
        if (pid) {
          // Windows: taskkill /T /F to kill the whole process tree
          try {
            child_process.execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
          } catch {
            activeRun.proc.kill('SIGKILL');
          }
        }
        sendJson(res, { stopped: runId });
        return;
      }

      // --- API: Retire / Unretire (CC-5) ---
      const retireMatch = pathname.match(/^\/api\/(retire|unretire)\/(.+)$/);
      if (retireMatch && req.method === 'POST') {
        const action = retireMatch[1];
        const id = decodeURIComponent(retireMatch[2]);
        const meta = await loadMetaOverlay(projectRoot);
        if (!meta[id]) meta[id] = {};
        meta[id].retired = action === 'retire';
        await saveMetaOverlay(projectRoot, meta);
        await appendAudit(projectRoot, {
          action, id, time: new Date().toISOString(), result: 'ok',
        });
        sendJson(res, { ok: true, action, id });
        return;
      }

      // --- API: Delete (archive) a file-backed runnable (CC-5) ---
      const deleteMatch = pathname.match(/^\/api\/delete\/(.+)$/);
      if (deleteMatch && req.method === 'POST') {
        const id = decodeURIComponent(deleteMatch[1]);
        const cat = await buildCatalog({ projectRoot, includeRetired: true });
        const r = cat.find((x) => x.id === id);
        if (!r) { send404(res, `Not found: ${id}`); return; }
        if (r.kind !== 'scenario' && r.kind !== 'deck') {
          send400(res, `Cannot delete a ${r.kind} — code-defined runnables can only be retired`);
          return;
        }
        if (!r.sourcePath) { send400(res, 'No source path'); return; }
        if (activeRun?.runnableId === id) { send409(res, 'Cannot delete while running'); return; }

        const srcFull = path.join(projectRoot, r.sourcePath);
        if (!isSafePath(projectRoot, srcFull)) { send400(res, 'Path traversal rejected'); return; }

        // Check for uncommitted changes (another session's work)
        try {
          const { execSync } = await import('node:child_process');
          const diff = execSync(`git diff --name-only -- "${r.sourcePath}"`, {
            cwd: projectRoot, encoding: 'utf8',
          }).trim();
          if (diff) {
            send400(res, `Cannot archive: ${r.sourcePath} has uncommitted changes (may be another session's work)`);
            return;
          }
        } catch { /* git not available — allow */ }

        const archiveDir = path.join(projectRoot, 'archive', r.kind);
        const archivePath = path.join(archiveDir, path.basename(r.sourcePath));
        await fsp.mkdir(archiveDir, { recursive: true });
        await fsp.rename(srcFull, archivePath);

        await appendAudit(projectRoot, {
          action: 'delete', id, time: new Date().toISOString(),
          result: 'ok', detail: `moved to ${path.relative(projectRoot, archivePath)}`,
        });
        sendJson(res, { ok: true, archived: path.relative(projectRoot, archivePath) });
        return;
      }

      // --- API: Restore a file-backed runnable (CC-5) ---
      const restoreMatch = pathname.match(/^\/api\/restore\/(.+)$/);
      if (restoreMatch && req.method === 'POST') {
        const id = decodeURIComponent(restoreMatch[1]);
        // Parse kind:name from id
        const colonIdx = id.indexOf(':');
        if (colonIdx === -1) { send400(res, 'Invalid runnable id'); return; }
        const kind = id.substring(0, colonIdx);
        const name = id.substring(colonIdx + 1);

        const kindDirs: Record<string, string> = { scenario: 'scenarios', deck: 'demos' };
        const srcDir = kindDirs[kind];
        if (!srcDir) { send400(res, `Cannot restore a ${kind}`); return; }

        const archivePath = path.join(projectRoot, 'archive', kind, name + (kind === 'deck' ? '.xlsx' : '.json'));
        const destPath = path.join(projectRoot, srcDir, name + (kind === 'deck' ? '.xlsx' : '.json'));

        if (!isSafePath(projectRoot, archivePath) || !isSafePath(projectRoot, destPath)) {
          send400(res, 'Path traversal rejected'); return;
        }

        try {
          await fsp.access(archivePath);
        } catch {
          send404(res, `No archived file found for ${id}`);
          return;
        }

        await fsp.rename(archivePath, destPath);
        await appendAudit(projectRoot, {
          action: 'restore', id, time: new Date().toISOString(), result: 'ok',
        });
        sendJson(res, { ok: true, restored: path.relative(projectRoot, destPath) });
        return;
      }

      // --- API: Delete run (move to trash) (CC-5) ---
      const deleteRunMatch = pathname.match(/^\/api\/delete-run\/(.+)$/);
      if (deleteRunMatch && req.method === 'POST') {
        const runId = decodeURIComponent(deleteRunMatch[1]);
        if (activeRun?.runId === runId) { send409(res, 'Cannot delete an active run'); return; }

        const records = await readRunIndex(runsRoot);
        const rec = records.find((r) => r.runId === runId);
        if (!rec?.outputDir) { send404(res, 'Run not found or no output dir'); return; }
        if (!isSafePath(projectRoot, rec.outputDir)) { send400(res, 'Path traversal rejected'); return; }

        const trashDir = path.join(runsRoot, '.trash', runId);
        await fsp.mkdir(path.dirname(trashDir), { recursive: true });
        await fsp.rename(rec.outputDir, trashDir);

        await appendAudit(projectRoot, {
          action: 'delete-run', id: runId, time: new Date().toISOString(), result: 'ok',
        });
        sendJson(res, { ok: true, trashed: runId });
        return;
      }

      // --- API: Restore run from trash (CC-5) ---
      const restoreRunMatch = pathname.match(/^\/api\/restore-run\/(.+)$/);
      if (restoreRunMatch && req.method === 'POST') {
        const runId = decodeURIComponent(restoreRunMatch[1]);
        const trashDir = path.join(runsRoot, '.trash', runId);
        if (!isSafePath(projectRoot, trashDir)) { send400(res, 'Path traversal rejected'); return; }

        try { await fsp.access(trashDir); } catch { send404(res, 'Not in trash'); return; }

        const restoreDir = path.join(runsRoot, runId);
        await fsp.rename(trashDir, restoreDir);

        await appendAudit(projectRoot, {
          action: 'restore-run', id: runId, time: new Date().toISOString(), result: 'ok',
        });
        sendJson(res, { ok: true, restored: runId });
        return;
      }

      // --- API: Duplicate a file-backed runnable (CC-5) ---
      const dupMatch = pathname.match(/^\/api\/duplicate\/(.+)$/);
      if (dupMatch && req.method === 'POST') {
        const id = decodeURIComponent(dupMatch[1]);
        const body = await readBody(req);
        const newName = String(body.newName ?? '').trim();
        if (!newName || !/^[a-z0-9][a-z0-9_-]*$/i.test(newName)) {
          send400(res, 'Invalid name — alphanumeric, hyphens and underscores only');
          return;
        }

        const cat = await buildCatalog({ projectRoot, includeRetired: true });
        const r = cat.find((x) => x.id === id);
        if (!r || !r.sourcePath) { send404(res, `Not found: ${id}`); return; }
        if (r.kind !== 'scenario' && r.kind !== 'deck') {
          send400(res, `Cannot duplicate a ${r.kind}`);
          return;
        }

        const ext = path.extname(r.sourcePath);
        const destPath = path.join(path.dirname(r.sourcePath), newName + ext);
        const destFull = path.join(projectRoot, destPath);

        if (!isSafePath(projectRoot, destFull)) { send400(res, 'Path traversal rejected'); return; }

        try { await fsp.access(destFull); send400(res, `File already exists: ${destPath}`); return; } catch { /* good */ }

        await fsp.copyFile(path.join(projectRoot, r.sourcePath), destFull);

        // Add meta entry
        const meta = await loadMetaOverlay(projectRoot);
        const newId = `${r.kind}:${newName}`;
        meta[newId] = { summary: `Copy of ${r.name}` };
        await saveMetaOverlay(projectRoot, meta);

        await appendAudit(projectRoot, {
          action: 'duplicate', id, time: new Date().toISOString(),
          result: 'ok', detail: `created ${newId} at ${destPath}`,
        });
        sendJson(res, { ok: true, newId, path: destPath });
        return;
      }

      send404(res);
    } catch (err) {
      console.error(`[center] ${req.method} ${pathname}: ${err}`);
      sendJson(res, { error: String(err) }, 500);
    }
  });

  function serveFile(res: http.ServerResponse, filePath: string, contentType: string): void {
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      // Fallback for missing shared assets
      res.writeHead(200, { 'Content-Type': contentType });
      res.end('/* not found */');
    }
  }

  return new Promise<http.Server>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as import('node:net').AddressInfo;
      console.log(`Command Center: http://127.0.0.1:${addr.port}/`);
      resolve(server);
    });
  });
}
