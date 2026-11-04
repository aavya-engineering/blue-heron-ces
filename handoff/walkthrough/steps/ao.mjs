// AdminOps driver steps (PLAN.md section 3, rows 13 and 15). Step 13 drives the AO console page (the same selectors
// as ces-tester's ao-ui-driver.ts) and fills the A-01 form fields ces-ao\public\index.html renders as #param-<name>.
// Step 15 drives the AO SPA at /app/ (selectors as ces-tester's ao-console-driver.ts AO_KIT).
import { NotDrivable, requireOnScreen, shot, writeFacts, textOf, tid, browserUrl } from './common.mjs';

const AO = {
  search: '#commandSearchInput',
  commandItem: '.command-item',
  searchResult: (id) => `#searchResults .search-result-item[onclick="openCommandForm('${id}')"]`,
  commandForm: '#commandForm',
  liveToggle: '#liveExecToggle',
  tenantSelect: '#tenantSelect',
  tenantOption: (slug) => `#tenantSelect option[value="${slug}"]`,
  execute: '#executeBtn',
  resultPanel: '#resultPanel',
  statusBadge: '#resultStatusBadge',
  evidenceSection: '#evidenceSection',
  outcomeBadge: '#evidenceOutcomeBadge',
};

/** Step 13: add a user with A-01 (New User Provisioning) on the AO console. */
export async function aoAddUser(ctx) {
  const { cfg, raw } = ctx;
  const cmd = 'A-01';
  await raw.goto(browserUrl(ctx, 'ao'), { waitUntil: 'domcontentloaded' });
  await ctx.caption('AdminOps: find the governed command for a new joiner (A-01, New User Provisioning)');
  await requireOnScreen(raw, AO.search, 'command search', 60_000, 'ces-ao public/index.html');
  await raw.locator(AO.commandItem).first().waitFor({ state: 'attached', timeout: 60_000 });
  await raw.locator(AO.search).fill(cmd);
  await raw.locator(AO.searchResult(cmd)).waitFor({ state: 'attached', timeout: 30_000 });
  await raw.locator(AO.searchResult(cmd)).click();
  await raw.locator(AO.commandForm).waitFor({ state: 'visible', timeout: 30_000 });
  await ctx.caption('Arm it against the simulated tenant, live');
  await raw.locator(AO.tenantOption(cfg.tenantSlug)).waitFor({ state: 'attached', timeout: 60_000 });
  await raw.locator(AO.tenantSelect).selectOption(cfg.tenantSlug);
  await raw.locator(AO.liveToggle).check();
  await requireOnScreen(raw, '#param-upn', 'A-01 UPN field', 15_000, 'ces-ao public/index.html:1263 (param-<name> fields)');
  await ctx.caption('Fill the joiner: user principal name and display name (fictional)');
  await raw.locator('#param-upn').fill(cfg.aoNewUser.upn);
  await raw.locator('#param-displayName').fill(cfg.aoNewUser.displayName);
  const bindings = {};
  for (const name of ['m365LicenseSkuId', 'baseGroupId', 'tenantId', 'cuiGroupId']) {
    const sel = `#param-${name}`;
    bindings[name] = (await raw.locator(sel).count()) > 0 ? ((await raw.locator(sel).inputValue()) ? 'filled from the tenant record' : 'empty') : 'not on the form';
  }
  await shot(ctx, 'ao-add-user-01-form.png');
  const emptyRequired = ['m365LicenseSkuId', 'baseGroupId'].filter((n) => bindings[n] === 'empty');
  if (emptyRequired.length) {
    writeFacts(ctx, 'ao-add-user.json', { command: cmd, executed: false, bindings });
    throw new NotDrivable(
      `A-01's required read-only fields ${emptyRequired.join(' and ')} are empty: AdminOps fills them from the tenant record's resources, ` +
        'and no screen writes the pushed Tenant Manifest\'s values there yet. Execute was not pressed.',
      'ces-ao public/index.html (tenantBindings); ces-tester src/flow/muster-e2e-run.ts E5 resourcesFromTm',
    );
  }
  const tenant = await raw.locator(AO.tenantSelect).inputValue();
  if (tenant !== cfg.tenantSlug) return { ok: false, error: `#tenantSelect did not stick on ${cfg.tenantSlug} (read "${tenant}")` };
  await ctx.caption('Execute: the command runs through the governed pipeline and writes its own evidence');
  const [resp] = await Promise.all([
    raw.waitForResponse((r) => r.url().includes(`/api/execute/${cmd}`), { timeout: 300_000 }),
    raw.locator(AO.execute).click(),
  ]);
  await raw.locator(AO.resultPanel).waitFor({ state: 'visible', timeout: 60_000 });
  const statusBadge = await textOf(raw, AO.statusBadge);
  const outcomeBadge = (await raw.locator(AO.evidenceSection).isVisible()) ? await textOf(raw, AO.outcomeBadge) : '';
  await shot(ctx, 'ao-add-user-02-result.png');
  let serverSaid = '';
  try {
    const body = await resp.json();
    serverSaid = String(body?.error ?? body?.message ?? '').slice(0, 300);
  } catch { /* not JSON */ }
  writeFacts(ctx, 'ao-add-user.json', { command: cmd, executed: true, httpStatus: resp.status(), statusBadge, outcomeBadge, serverSaid, bindings });
  if (!/success|pending/i.test(statusBadge)) {
    return { ok: false, error: `A-01 ended with status "${statusBadge || 'none'}" (HTTP ${resp.status()}); readonly bindings: ${JSON.stringify(bindings)}` };
  }
  return { ok: true };
}

/** Step 15: the AO SPA (/app/): a dry run of A-18 writes an evidence row, shown in "Evidence rows (this session)". */
export async function aoEvidence(ctx) {
  const { cfg, raw } = ctx;
  const cmd = 'A-18';
  await raw.goto(`${browserUrl(ctx, 'ao')}/app/`, { waitUntil: 'domcontentloaded' });
  await ctx.caption('AdminOps console (/app): the newer screen for the same governed commands');
  await requireOnScreen(raw, tid('command-search'), 'AO SPA command search', 60_000, 'ces-ao ui/src/screens/commands/CommandList.tsx');
  await raw.locator(tid('command-search')).fill(cmd);
  await raw.locator(tid(`search-cmd-${cmd}`)).waitFor({ state: 'attached', timeout: 30_000 });
  await raw.locator(tid(`search-cmd-${cmd}`)).click();
  await raw.locator(`[data-testid="form-title"][data-command-id="${cmd}"]`).waitFor({ state: 'attached', timeout: 30_000 });
  await raw.locator(`[data-testid="tenant-select"] option[value="${cfg.tenantSlug}"]`).waitFor({ state: 'attached', timeout: 60_000 });
  await raw.locator(tid('tenant-select')).selectOption(cfg.tenantSlug);
  await ctx.caption('Dry run: AdminOps checks the change and records an evidence row without changing the tenant');
  await requireOnScreen(raw, tid('dry-run'), 'dry run button', 15_000, 'ces-ao ui/src/screens/request/RequestForm.tsx');
  await Promise.all([
    raw.waitForResponse((r) => r.url().includes(`/api/execute/${cmd}`) && r.request().method() === 'POST', { timeout: 300_000 }),
    raw.locator(tid('dry-run')).click(),
  ]);
  await requireOnScreen(raw, '[data-testid^="evidence-row-"]', 'evidence row in the session table', 60_000, 'ces-ao ui/src/screens/evidence/EvidenceRows.tsx');
  await ctx.caption('The evidence row: command, step, outcome, verdict, objectives and correlation id');
  const row = raw.locator('[data-testid^="evidence-row-"]').first();
  await row.scrollIntoViewIfNeeded();
  const facts = {
    command: await row.getAttribute('data-command-id'),
    mode: await row.getAttribute('data-mode'),
    outcome: await row.getAttribute('data-outcome'),
    verdict: await row.getAttribute('data-verdict'),
    correlationId: await row.getAttribute('data-correlation-id'),
    evidenceLost: await row.getAttribute('data-evidence-lost'),
  };
  await shot(ctx, 'ao-evidence-01-row.png');
  writeFacts(ctx, 'ao-evidence.json', facts);
  if (facts.evidenceLost === 'true') return { ok: false, error: 'the evidence row says EVIDENCE NOT PERSISTED' };
  return { ok: true };
}
