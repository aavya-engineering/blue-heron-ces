// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 P13-LV: the leaver flow's routes (LeaverFlowService.ts).
//
// Operator routes, mounted under /api behind AO's bearer gate:
//   GET  /api/leaver/settings?tenant=            the tenant's settings (admin recipients, BHD opt-in, windows)
//   PUT  /api/leaver/settings?tenant=            change them
//   POST /api/leaver/scan?tenant=                read the leave signal; start a flow per enabled past leaver
//   POST /api/leaver/flows                       operator / HR input: { tenant, upn, employeeLeaveDateTime?, reason? }
//   GET  /api/leaver/flows?tenant=               the tenant's flows (token hashes left out)
//   GET  /api/leaver/flows/:id                   one flow
//   POST /api/leaver/flows/:id/resume            two-person approval on: run A-22 once the approval is decided
//   POST /api/leaver/tick?tenant=                reminders and escalations now (the timer does the same)
//   GET  /api/leaver/outbox?tenant=              the tenant's simulated messages as delivered (PL-122: ces.db keeps each
//                                                confirm link as ?t=<redacted>; an open flow's clear links come from
//                                                process memory, marked delivered_copy: true)
//   GET  /api/leaver/escalations?tenant=         the tenant's escalation records
// Confirm routes, mounted BEFORE the bearer gate: the single-use token in the link is the gate (a tenant
// administrator holds no AO bearer token). GET only shows the page (mail scanners fetch links); POST decides.
//   GET  /leaver/confirm/:flowId?t=TOKEN
//   POST /leaver/confirm/:flowId                 { t, decision: 'confirm' | 'decline', reason? } (JSON or form)

import express, { Router, type Request, type Response } from 'express';
import { getRequestPrincipal } from 'ces-shared/http/principal';
import { LeaverConfirmError, LeaverFlowService, publicFlow } from '../../leaver/LeaverFlowService.js';
import { getFlow, getSettings, listEscalations, listFlows, listOutboxDelivered, putSettings } from '../../leaver/leaverStore.js';

const SLUG = /^[A-Za-z0-9._-]+$/;

function slugOf(req: Request, res: Response): string | null {
  const raw = typeof req.query.tenant === 'string' ? req.query.tenant : typeof req.body?.tenant === 'string' ? req.body.tenant : '';
  const slug = raw.trim();
  if (!slug || !SLUG.test(slug)) {
    res.status(400).json({ error: 'tenant (a tenant slug) is required' });
    return null;
  }
  return slug;
}

function fail(res: Response, e: unknown): void {
  if (e instanceof LeaverConfirmError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  res.status(/not found|unknown tenant|no tenant/i.test(msg) ? 404 : 400).json({ error: msg });
}

export function createLeaverRouter(service: LeaverFlowService): Router {
  const router = Router();

  router.get('/leaver/settings', (req, res) => {
    const slug = slugOf(req, res);
    if (slug) res.json(getSettings(slug, new Date().toISOString()));
  });

  router.put('/leaver/settings', (req, res) => {
    const slug = slugOf(req, res);
    if (!slug) return;
    try {
      const by = getRequestPrincipal(req)?.upn ?? null;
      const b = req.body ?? {};
      res.json(putSettings(slug, undefined, {
        ...(b.adminRecipients !== undefined ? { adminRecipients: b.adminRecipients } : {}),
        ...(b.notifyBhdOnDone !== undefined ? { notifyBhdOnDone: b.notifyBhdOnDone } : {}),
        ...(b.reminderAfterMinutes !== undefined ? { reminderAfterMinutes: b.reminderAfterMinutes } : {}),
        ...(b.confirmWindowMinutes !== undefined ? { confirmWindowMinutes: b.confirmWindowMinutes } : {}),
      }, by, new Date().toISOString()));
    } catch (e) {
      fail(res, e);
    }
  });

  router.post('/leaver/scan', async (req, res) => {
    const slug = slugOf(req, res);
    if (!slug) return;
    try {
      const r = await service.scan(slug);
      res.json({ ...r, started: r.started.map(publicFlow) });
    } catch (e) {
      fail(res, e);
    }
  });

  router.post('/leaver/flows', async (req, res) => {
    const slug = slugOf(req, res);
    if (!slug) return;
    const b = req.body ?? {};
    if (typeof b.upn !== 'string' || !b.upn.trim()) {
      res.status(400).json({ error: 'upn (the leaver) is required' });
      return;
    }
    const leaveAt = typeof b.employeeLeaveDateTime === 'string' && !Number.isNaN(Date.parse(b.employeeLeaveDateTime))
      ? new Date(b.employeeLeaveDateTime).toISOString() : null;
    try {
      const by = getRequestPrincipal(req)?.upn ?? (typeof b.requestedBy === 'string' ? b.requestedBy : null);
      const r = await service.start({
        tenantSlug: slug,
        upn: b.upn,
        employeeLeaveDateTime: leaveAt,
        source: {
          kind: 'operator_input',
          detail: `operator / HR input${typeof b.reason === 'string' && b.reason.trim() ? `: ${b.reason.trim().slice(0, 300)}` : ''}`,
          requestedBy: by,
        },
      });
      res.status(r.created ? 201 : 200).json({ created: r.created, flow: publicFlow(r.flow) });
    } catch (e) {
      fail(res, e);
    }
  });

  router.get('/leaver/flows', (req, res) => {
    const slug = slugOf(req, res);
    if (slug) res.json(listFlows(slug).map(publicFlow));
  });

  router.get('/leaver/flows/:id', (req, res) => {
    const f = getFlow(req.params.id);
    if (!f) res.status(404).json({ error: 'no such leaver flow' });
    else res.json(publicFlow(f));
  });

  router.post('/leaver/flows/:id/resume', async (req, res) => {
    try {
      res.json(publicFlow(await service.resume(req.params.id)));
    } catch (e) {
      fail(res, e);
    }
  });

  router.post('/leaver/tick', (req, res) => {
    const slug = slugOf(req, res);
    if (slug) res.json(service.tick(slug));
  });

  router.get('/leaver/outbox', (req, res) => {
    const slug = slugOf(req, res);
    if (slug) res.json(listOutboxDelivered(slug));
  });

  router.get('/leaver/escalations', (req, res) => {
    const slug = slugOf(req, res);
    if (slug) res.json(listEscalations(slug));
  });

  return router;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(title)}</title>` +
    '<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}' +
    'button{font-size:1rem;padding:.5rem 1rem;margin-right:.5rem}textarea{width:100%}</style></head>' +
    `<body><h1>${esc(title)}</h1>${body}</body></html>`;
}

/** The token-gated confirm routes. Mount BEFORE the bearer gate. */
export function createLeaverConfirmRouter(service: LeaverFlowService): Router {
  const router = Router();
  router.use('/leaver/confirm', express.urlencoded({ extended: false, limit: '16kb' }));

  router.get('/leaver/confirm/:flowId', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const token = typeof req.query.t === 'string' ? req.query.t : '';
    try {
      const { flow, recipient } = service.view(req.params.flowId, token);
      const when = flow.leaver.employeeLeaveDateTime ? ` (leave date ${esc(flow.leaver.employeeLeaveDateTime)})` : '';
      res.type('html').send(page('Confirm a leaver', `<p>Tenant <b>${esc(flow.tenantSlug)}</b>: <b>${esc(flow.leaver.upn)}</b>${when} can still sign in.</p>` +
        `<p>Confirming runs AdminOps A-22: the account is disabled, every sign-in session is revoked, and its group memberships, licences and MFA methods are removed. Nothing has changed yet.</p>` +
        `<p>This link was sent to ${esc(recipient)} and works once.</p>` +
        `<form method="post" action="/leaver/confirm/${esc(encodeURIComponent(flow.flowId))}"><input type="hidden" name="t" value="${esc(token)}">` +
        '<p><label>Reason (for a decline)<br><textarea name="reason" rows="2"></textarea></label></p>' +
        '<button name="decision" value="confirm">Confirm: end this access</button><button name="decision" value="decline">Decline: not a leaver</button></form>'));
    } catch (e) {
      const status = e instanceof LeaverConfirmError ? e.status : 400;
      res.status(status).type('html').send(page('Link not valid', `<p>${esc(e instanceof Error ? e.message : String(e))}</p>`));
    }
  });

  router.post('/leaver/confirm/:flowId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const b = req.body ?? {};
    const token = typeof b.t === 'string' ? b.t : '';
    const decision = b.decision === 'decline' ? 'decline' : b.decision === 'confirm' ? 'confirm' : null;
    const wantsHtml = !req.is('application/json');
    if (!decision) {
      res.status(400).json({ error: "decision must be 'confirm' or 'decline'" });
      return;
    }
    try {
      const flow = await service.decide(req.params.flowId, token, decision, typeof b.reason === 'string' ? b.reason : undefined);
      if (wantsHtml) {
        res.type('html').send(page(`Leaver ${flow.status}`, `<p>${esc(flow.leaver.upn)}: ${esc(flow.status)}. ${esc(flow.execution?.summary ?? flow.declinedReason ?? '')}</p>`));
        return;
      }
      res.json({
        flowId: flow.flowId,
        status: flow.status,
        confirmedBy: flow.confirmedBy ?? null,
        declinedBy: flow.declinedBy ?? null,
        execution: flow.execution ?? null,
        approvalId: flow.approvalId ?? null,
      });
    } catch (e) {
      if (wantsHtml && e instanceof LeaverConfirmError) {
        res.status(e.status).type('html').send(page('Link not valid', `<p>${esc(e.message)}</p>`));
        return;
      }
      fail(res, e);
    }
  });
  return router;
}

/**
 * Optional timer: CES_AO_LEAVER_TICK_MIN > 0 runs scan + tick for the tenants in CES_AO_LEAVER_TENANTS
 * (comma-separated slugs) every N minutes. Off by default (no timer, no scan): a scan reads the tenant.
 */
export function startLeaverTimer(service: LeaverFlowService, env: NodeJS.ProcessEnv = process.env, log: Pick<Console, 'log' | 'warn'> = console): NodeJS.Timeout | null {
  const min = Number(env['CES_AO_LEAVER_TICK_MIN'] ?? '');
  const tenants = String(env['CES_AO_LEAVER_TENANTS'] ?? '').split(',').map((s) => s.trim()).filter((s) => SLUG.test(s));
  if (!Number.isFinite(min) || min <= 0 || tenants.length === 0) return null;
  let running = false;
  const t = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      for (const slug of tenants) {
        try {
          await service.scan(slug);
          service.tick(slug);
        } catch (e) {
          log.warn(`[LeaverFlow] timer ${slug}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })().finally(() => { running = false; });
  }, Math.max(1, min) * 60_000);
  t.unref?.();
  log.log(`[LeaverFlow] timer: scan + tick every ${min} min for ${tenants.join(', ')}`);
  return t;
}
