#!/usr/bin/env node
// MX (Blue Heron Defense, CES team): mint a bhd_operator bearer token for the
// muster-api routes that need no database (/api/plan, /api/harvest, /api/discovery).
// It signs the same payload shape muster-api's src/lib/jwt.ts verifies, with the
// jsonwebtoken copy muster-api already installs.
//
//   JWT_SECRET=<same secret the server was started with> \
//     node mint-token.mjs <ces-root> [tenant_id]      -> prints the token
import { createRequire } from 'node:module';
import * as path from 'node:path';

const [cesRoot, tenantId = 'mx-sim-tenant'] = process.argv.slice(2);
if (!cesRoot || !process.env.JWT_SECRET) {
  console.error('usage: JWT_SECRET=... node mint-token.mjs <ces-root> [tenant_id]');
  process.exit(2);
}
const require = createRequire(path.join(cesRoot, 'ces-muster', 'muster-api', 'package.json'));
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'mx-operator', tenant_id: tenantId, party_id: null, role: 'bhd_operator' },
  process.env.JWT_SECRET,
  { expiresIn: '2h' }
);
process.stdout.write(token);
