// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// deliveryService.ts — GP-MUSTER-2 M2: the delivery portal's engine.
// docs/design/result-handling-policy.md is NORMATIVE; the rules it states are
// implemented here, not just described:
//   rule 1  per-engagement scope: every query filters tenant_id AND
//           engagement_id explicitly (defense in depth under the RLS policies);
//   rule 2  named grants only, issued by an operator;
//   rule 3  short-lived tokens (default 7 days/issue), expiry ends access;
//   rule 4  download-only — this service exposes NO artifact mutation to
//           grantees (register/purge are operator paths);
//   rule 5  audit on every touch — pulls, denials, issues, revokes, purges;
//           audit entries are never deleted here;
//   rule 6  retention: purge 90 days after delivered_at (per-artifact clock);
//   rule 7  close-out purge with recorded reason;
//   token at rest: sha256 hash only — the plaintext capability is returned
//   exactly once at issue time.
import { createHash, randomBytes } from 'node:crypto';

export const RETENTION_DAYS = 90;
export const GRANT_TTL_DAYS_DEFAULT = 7;
export const GRANT_TTL_DAYS_MAX = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ArtifactKind = 'readiness_result' | 'readiness_report' | 'capture';

export interface DeliveryGrantRow {
  id: string;
  tenant_id: string;
  engagement_id: string;
  grantee_name: string;
  grantee_email: string;
  issued_by: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface ArtifactMeta {
  id: string;
  kind: string;
  filename: string;
  content_sha256: string;
  delivered_at: Date;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The one place a capability token is minted. 256 bits, base64url. */
export function mintGrantToken(): string {
  return randomBytes(32).toString('base64url');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDeliveryService(tx: any) {
  async function audit(entry: {
    tenant_id: string;
    engagement_id: string;
    artifact_id?: string | null;
    grant_id?: string | null;
    actor: string;
    action: 'grant_issued' | 'grant_revoked' | 'artifact_registered' | 'pull' | 'denied' | 'purge';
    outcome: string;
    detail?: string | null;
  }): Promise<void> {
    await tx.deliveryAuditEntry.create({
      data: {
        tenant_id: entry.tenant_id,
        engagement_id: entry.engagement_id,
        artifact_id: entry.artifact_id ?? null,
        grant_id: entry.grant_id ?? null,
        actor: entry.actor,
        action: entry.action,
        outcome: entry.outcome,
        detail: entry.detail ?? null,
      },
    });
  }

  return {
    /** Operator path: register an artifact for delivery (policy rule 4 — the
     * portal itself never accepts content). */
    async registerArtifact(input: {
      tenant_id: string;
      engagement_id: string;
      kind: ArtifactKind;
      filename: string;
      content: Buffer;
      actor: string;
      delivered_at?: Date;
    }) {
      const artifact = await tx.deliveryArtifact.create({
        data: {
          tenant_id: input.tenant_id,
          engagement_id: input.engagement_id,
          kind: input.kind,
          filename: input.filename,
          content: input.content,
          content_sha256: sha256(input.content),
          delivered_at: input.delivered_at ?? new Date(),
          purged_at: null,
          purge_reason: null,
        },
      });
      await audit({
        tenant_id: input.tenant_id,
        engagement_id: input.engagement_id,
        artifact_id: artifact.id,
        actor: input.actor,
        action: 'artifact_registered',
        outcome: 'ok',
        detail: `${input.kind}:${input.filename}`,
      });
      return { id: artifact.id, content_sha256: artifact.content_sha256 };
    },

    /** Operator path: issue a named, short-lived grant. Returns the plaintext
     * token EXACTLY ONCE — only its sha256 is stored (policy rules 2-3). */
    async issueGrant(input: {
      tenant_id: string;
      engagement_id: string;
      grantee_name: string;
      grantee_email: string;
      issued_by: string;
      expires_in_days?: number;
      now?: Date;
    }) {
      const days = Math.min(input.expires_in_days ?? GRANT_TTL_DAYS_DEFAULT, GRANT_TTL_DAYS_MAX);
      const now = input.now ?? new Date();
      const token = mintGrantToken();
      const grant = await tx.deliveryGrant.create({
        data: {
          tenant_id: input.tenant_id,
          engagement_id: input.engagement_id,
          grantee_name: input.grantee_name,
          grantee_email: input.grantee_email,
          issued_by: input.issued_by,
          token_hash: sha256(token),
          expires_at: new Date(now.getTime() + days * DAY_MS),
          revoked_at: null,
        },
      });
      await audit({
        tenant_id: input.tenant_id,
        engagement_id: input.engagement_id,
        grant_id: grant.id,
        actor: input.issued_by,
        action: 'grant_issued',
        outcome: 'ok',
        detail: `grantee:${input.grantee_name} expires:${grant.expires_at.toISOString()}`,
      });
      return { grant_id: grant.id, token, expires_at: grant.expires_at };
    },

    /** Operator path: revoke a grant before expiry. */
    async revokeGrant(input: { tenant_id: string; grant_id: string; actor: string; now?: Date }) {
      const grant = await tx.deliveryGrant.findUnique({ where: { id: input.grant_id } });
      if (!grant || grant.tenant_id !== input.tenant_id) return null;
      const updated = await tx.deliveryGrant.update({
        where: { id: input.grant_id },
        data: { revoked_at: input.now ?? new Date() },
      });
      await audit({
        tenant_id: grant.tenant_id,
        engagement_id: grant.engagement_id,
        grant_id: grant.id,
        actor: input.actor,
        action: 'grant_revoked',
        outcome: 'ok',
      });
      return updated;
    },

    /**
     * Portal path: resolve a presented token to a LIVE grant. Returns the
     * grant, or a typed refusal so the caller can audit denials that have an
     * attributable engagement (expired/revoked) and 401 the rest.
     */
    async resolveGrant(
      token: string,
      now: Date = new Date()
    ): Promise<
      | { ok: true; grant: DeliveryGrantRow }
      | { ok: false; reason: 'unknown' | 'expired' | 'revoked'; grant?: DeliveryGrantRow }
    > {
      const grant = (await tx.deliveryGrant.findUnique({
        where: { token_hash: sha256(token) },
      })) as DeliveryGrantRow | null;
      if (!grant) return { ok: false, reason: 'unknown' };
      if (grant.revoked_at) return { ok: false, reason: 'revoked', grant };
      if (now.getTime() >= new Date(grant.expires_at).getTime())
        return { ok: false, reason: 'expired', grant };
      return { ok: true, grant };
    },

    /** Audit a refusal that has an attributable grant (expired/revoked). */
    async auditDeniedGrant(grant: DeliveryGrantRow, reason: string): Promise<void> {
      await audit({
        tenant_id: grant.tenant_id,
        engagement_id: grant.engagement_id,
        grant_id: grant.id,
        actor: grant.grantee_name,
        action: 'denied',
        outcome: reason,
      });
    },

    /** Portal path: list THIS grant's engagement's un-purged artifacts —
     * metadata only, never content (policy rule 1: nothing broader). */
    async listArtifacts(grant: DeliveryGrantRow): Promise<ArtifactMeta[]> {
      const rows = await tx.deliveryArtifact.findMany({
        where: { tenant_id: grant.tenant_id, engagement_id: grant.engagement_id, purged_at: null },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((a: any) => ({
        id: a.id,
        kind: a.kind,
        filename: a.filename,
        content_sha256: a.content_sha256,
        delivered_at: a.delivered_at,
      }));
    },

    /**
     * Portal path: pull one artifact's bytes. Every outcome is audited —
     * success as 'pull', wrong-engagement/purged/missing as 'denied' (policy
     * rules 1, 5). Wrong-engagement returns the same shape as missing so the
     * portal cannot be used to probe other engagements' artifact ids.
     */
    async pullArtifact(
      grant: DeliveryGrantRow,
      artifactId: string
    ): Promise<{ ok: true; filename: string; content: Buffer } | { ok: false }> {
      const artifact = await tx.deliveryArtifact.findUnique({ where: { id: artifactId } });
      const inScope =
        !!artifact &&
        artifact.tenant_id === grant.tenant_id &&
        artifact.engagement_id === grant.engagement_id;
      if (!inScope || artifact.purged_at) {
        await audit({
          tenant_id: grant.tenant_id,
          engagement_id: grant.engagement_id,
          artifact_id: artifactId,
          grant_id: grant.id,
          actor: grant.grantee_name,
          action: 'denied',
          outcome: !artifact ? 'missing' : !inScope ? 'out_of_scope' : 'purged',
        });
        return { ok: false };
      }
      await audit({
        tenant_id: grant.tenant_id,
        engagement_id: grant.engagement_id,
        artifact_id: artifact.id,
        grant_id: grant.id,
        actor: grant.grantee_name,
        action: 'pull',
        outcome: 'ok',
        detail: artifact.filename,
      });
      return { ok: true, filename: artifact.filename, content: Buffer.from(artifact.content) };
    },

    /** Retention purge (policy rule 6): zero content on everything delivered
     * more than RETENTION_DAYS ago. Rows and audit trail remain. */
    async purgeExpired(input: { tenant_id: string; actor: string; now?: Date }) {
      const now = input.now ?? new Date();
      const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
      const candidates = await tx.deliveryArtifact.findMany({
        where: { tenant_id: input.tenant_id, purged_at: null },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expired = candidates.filter((a: any) => new Date(a.delivered_at) <= cutoff);
      for (const artifact of expired) {
        await tx.deliveryArtifact.update({
          where: { id: artifact.id },
          data: { content: Buffer.alloc(0), purged_at: now, purge_reason: 'retention' },
        });
        await audit({
          tenant_id: artifact.tenant_id,
          engagement_id: artifact.engagement_id,
          artifact_id: artifact.id,
          actor: input.actor,
          action: 'purge',
          outcome: 'ok',
          detail: 'retention',
        });
      }
      return { purged: expired.length };
    },

    /** Close-out purge (policy rule 7): purge one engagement's artifacts early,
     * with the reason recorded. */
    async purgeEngagement(input: {
      tenant_id: string;
      engagement_id: string;
      reason: string;
      actor: string;
      now?: Date;
    }) {
      const now = input.now ?? new Date();
      const rows = await tx.deliveryArtifact.findMany({
        where: { tenant_id: input.tenant_id, engagement_id: input.engagement_id, purged_at: null },
      });
      for (const artifact of rows) {
        await tx.deliveryArtifact.update({
          where: { id: artifact.id },
          data: { content: Buffer.alloc(0), purged_at: now, purge_reason: input.reason },
        });
        await audit({
          tenant_id: input.tenant_id,
          engagement_id: input.engagement_id,
          artifact_id: artifact.id,
          actor: input.actor,
          action: 'purge',
          outcome: 'ok',
          detail: input.reason,
        });
      }
      return { purged: rows.length };
    },

    /** Operator path: the engagement's audit trail (never purged). */
    async auditTrail(input: { tenant_id: string; engagement_id: string }) {
      return tx.deliveryAuditEntry.findMany({
        where: { tenant_id: input.tenant_id, engagement_id: input.engagement_id },
      });
    },
  };
}
