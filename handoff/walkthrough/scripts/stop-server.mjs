// Stops a running walkthrough server cleanly (closes its browser windows, removes its run folder links).
import * as fs from 'node:fs';
import * as path from 'node:path';

const WT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
fs.mkdirSync(path.join(WT, 'runs'), { recursive: true });
fs.writeFileSync(path.join(WT, 'runs', 'STOP-SERVER'), new Date().toISOString());
console.log('stop requested; the server closes within a few seconds');
