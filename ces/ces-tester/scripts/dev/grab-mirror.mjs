// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Operator proof tool — observe the in-slide app pane WITHOUT watching the screen.
 *
 *   node scripts/dev/grab-mirror.mjs <outDir> [maxSeconds=300] [port=4500]
 *
 * Waits for the slides server, then subscribes to `GET /mirror` (the MJPEG the
 * slide's app pane streams) and carves the newest complete JPEG to disk every
 * ~1.5 s, named by slide index, op status and elapsed time. `GET /state` is
 * logged alongside each frame. When the deck reaches its last slide and that
 * slide's op has finished and dwelt, the show is ended over `POST /nav`
 * (`{action:{type:'exit'}}`), so an unattended proof run tears itself down.
 *
 * Node only — no dependencies — so it runs from any shell on the host.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

const [outDir = 'runs/theatre-proof', maxSecondsRaw = '300', portRaw = '4500'] = process.argv.slice(2);
const maxSeconds = Number(maxSecondsRaw);
const port = Number(portRaw);
fs.mkdirSync(outDir, { recursive: true });
const stateLog = fs.createWriteStream(path.join(outDir, 'state.log'), { flags: 'a' });
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);
const log = (line) => {
  const s = `[${elapsed()}s] ${line}`;
  console.log(s);
  stateLog.write(s + '\n');
};

function getJson(route) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: route, timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function postNav(action) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ action });
    const req = http.request({ host: '127.0.0.1', port, path: '/nav', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.end(body);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Wait for the server.
let state = null;
while (!state) {
  if ((Date.now() - t0) / 1000 > maxSeconds) { log('server never came up'); process.exit(2); }
  state = await getJson('/state');
  if (!state) await sleep(2000);
}
log(`server up: ${JSON.stringify(state)}`);

// 2. Subscribe to the mirror and keep the newest complete JPEG.
let buf = Buffer.alloc(0);
let mirrorStatus = 'connecting';
const req = http.get({ host: '127.0.0.1', port, path: '/mirror' }, (res) => {
  mirrorStatus = `HTTP ${res.statusCode} ${res.headers['content-type'] ?? ''}`;
  log(`mirror: ${mirrorStatus}`);
  res.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 4_000_000) buf = buf.subarray(buf.length - 2_000_000);
  });
  res.on('end', () => log('mirror: stream ended'));
});
req.on('error', (err) => log(`mirror: error ${err.message}`));

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
function newestJpeg() {
  const eoi = buf.lastIndexOf(EOI);
  if (eoi === -1) return null;
  const soi = buf.lastIndexOf(SOI, eoi);
  if (soi === -1) return null;
  return buf.subarray(soi, eoi + 2);
}

// 3. Tick: frame + state, and end the show when the deck is spent.
let frames = 0;
let lastHash = '';
let lastSlideDoneAt = null;
for (;;) {
  const sec = (Date.now() - t0) / 1000;
  state = (await getJson('/state')) ?? state;
  const jpeg = newestJpeg();
  if (jpeg) {
    const hash = `${jpeg.length}:${jpeg.readUInt32BE(jpeg.length - 8)}`;
    if (hash !== lastHash) {
      const name = `frame-${String(frames).padStart(3, '0')}-s${state.index + 1}-${state.opStatus}-${sec.toFixed(0)}s.jpg`;
      fs.writeFileSync(path.join(outDir, name), jpeg);
      frames += 1;
      lastHash = hash;
      log(`frame ${name} (${jpeg.length} bytes) state=${JSON.stringify(state)}`);
    } else {
      log(`(unchanged frame) state=${JSON.stringify(state)}`);
    }
  } else {
    log(`no jpeg yet (${buf.length} bytes buffered, ${mirrorStatus}) state=${JSON.stringify(state)}`);
  }

  if (state.exited) { log('show exited'); break; }
  const onLast = state.index >= state.slideCount - 1;
  const opSettled = state.opStatus === 'done' || state.opStatus === 'failed' || state.opStatus === 'none';
  if (onLast && opSettled) {
    lastSlideDoneAt ??= Date.now();
    if (Date.now() - lastSlideDoneAt > 20_000) { log('last slide settled — ending the show'); await postNav({ type: 'exit' }); await sleep(3000); break; }
  }
  if (sec > maxSeconds) { log('max seconds reached — ending the show'); await postNav({ type: 'exit' }); await sleep(3000); break; }
  await sleep(1500);
}
req.destroy();
log(`done: ${frames} frames in ${outDir}`);
stateLog.end();
process.exit(0);
