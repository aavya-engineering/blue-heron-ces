// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-11 (R-F8 S1 + S2 E7 "EC item list unavailable: fetch failed"). The cause, reproduced: EO read EC about 0.5 s
 * before the assess, so a kept-alive socket sat in fetch's pool. The assess then ran collector C11 synchronously
 * (1248 store appends, 9-13 s). EC's Node server (default keep-alive) closed the idle socket meanwhile, and once the
 * loop resumed, fetch wrote the EC read onto the dead socket: ECONNRESET. With EO's real C11 code and the real EC
 * process this failed 2 of 2 before the fix (LOG-PH11-EO.md §3b). Here the C11 block is a plain synchronous wait
 * of the same length, against a separate-process server with Node's default keep-alive.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { EcEvidenceReader } from '../../../src/eo/evidence/EcEvidenceReader';

describe('PH-11: the EC read after a long synchronous block (C11) on a kept-alive socket', () => {
  let child: ChildProcess | undefined;
  afterEach(() => { child?.kill(); child = undefined; });

  it('answers: the stale socket\'s ECONNRESET is retried once on a fresh connection', async () => {
    const script = "const http=require('node:http');const s=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end('[]')});s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)));";
    child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const port = await new Promise<number>((resolve) => child!.stdout!.once('data', (d: Buffer) => resolve(Number(String(d).trim()))));
    const reader = new EcEvidenceReader({ ecUrl: `http://127.0.0.1:${port}`, secret: 'probe' });
    expect(await reader.readItemsOrThrow('ph11-sim')).toEqual([]); // a socket now sits in the keep-alive pool
    await new Promise((r) => setTimeout(r, 500)); // EO's last EC request came ~0.5 s before the assess (R-F8 S1)
    const until = Date.now() + 8000; // C11's synchronous block (R-F8: 8.9 s and 10.5 s assess)
    while (Date.now() < until) { /* busy, as C11 */ }
    await expect(reader.readItemsOrThrow('ph11-sim')).resolves.toEqual([]);
  }, 30000);
});
