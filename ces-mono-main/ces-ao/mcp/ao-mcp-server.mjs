#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// ces-adminops MCP server — exposes AdminOps commands as governed MCP tools.
// Wraps the SAME headless engine the CLI uses (dist/execution/invokeCommand.js), so
// every call flows through the AO SoD gate / dryRun / evidence pipeline.
//
// SAFETY: dry-run is the default and a LIVE write (dryRun=false) is HARD-BLOCKED unless
// the env AO_MCP_ALLOW_APPLY=1 is set. This mirrors the read-only choke-point design of
// the tenant-test harness: the agent cannot accidentally mutate the live tenant.
//
// Transport: MCP stdio (newline-delimited JSON-RPC 2.0). Logs go to stderr ONLY.

// CRITICAL: stdio MCP requires stdout to carry ONLY JSON-RPC. The AO engine
// (PowerShellAdapter et al.) logs to stdout via console.log — capture the real stdout
// writer for our protocol, then redirect ALL other stdout + console output to stderr.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk, enc, cb) => process.stderr.write(chunk, enc, cb));
console.log = console.info = console.warn = console.debug = (...a) =>
  process.stderr.write(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');

// FX2-AO1: tool definitions and dispatch live in TypeScript (src/mcp/aoMcpTools.ts,
// compiled to dist/) so they are under test; this file is transport only.
// ao_approve takes the approving person's signed `principalToken` (verified with
// CES_AO_PRINCIPAL_SECRET from this process's env); a typed approverUPN is refused.
import { AO_MCP_TOOLS as TOOLS, callAoMcpTool } from '../dist/mcp/aoMcpTools.js';

const ALLOW_APPLY = process.env.AO_MCP_ALLOW_APPLY === '1';
const log = (...a) => process.stderr.write('[ces-adminops-mcp] ' + a.join(' ') + '\n');

const callTool = (name, args) => callAoMcpTool(name, args, { env: process.env });

// ---- minimal MCP stdio JSON-RPC ----
function send(msg) { realStdoutWrite(JSON.stringify(msg) + '\n'); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ces-adminops', version: '0.2.0', applyEnabled: ALLOW_APPLY },
    } });
    return;
  }
  if (method === 'notifications/initialized') return;   // no response
  if (method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      const data = await callTool(name, args);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] } });
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true } });
    }
    return;
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buf = '';
// Requests are handled STRICTLY IN ORDER. Concurrent handling raced approve-then-execute
// batches: ao_execute validated the approval before ao_approve had committed its decision.
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { log('bad JSON:', line); continue; }
    queue = queue.then(() => handle(msg)).catch(e => log('handler error:', e.message));
  }
});
log(`started (apply ${ALLOW_APPLY ? 'ENABLED' : 'blocked — dry-run only'})`);
