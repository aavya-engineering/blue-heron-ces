// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, vi } from 'vitest';
import { requireRole } from '../src/middleware/auth.js';
import type { Request, Response, NextFunction } from 'express';

type MockUser = {
  sub: string;
  tenant_id: string;
  party_id: string | null;
  role: string;
};

function mockReq(role: string): Partial<Request> & { user: MockUser } {
  return {
    user: { sub: 'user-1', tenant_id: 'tenant-1', party_id: null, role },
  } as Partial<Request> & { user: MockUser };
}

function mockRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('requireRole middleware', () => {
  it('prime passes prime-only route', () => {
    const req = mockReq('prime');
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    requireRole('prime')(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sub is rejected with 403 on prime-only route', () => {
    const req = mockReq('sub');
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    requireRole('prime')(req as unknown as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('bhd_operator passes write route', () => {
    const req = mockReq('bhd_operator');
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    requireRole('prime', 'bhd_operator')(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('assessor_read_only passes read route but is rejected on write route', () => {
    const req = mockReq('assessor_read_only');

    // Passes read route (all roles allowed)
    const resRead = mockRes();
    const nextRead = vi.fn() as unknown as NextFunction;
    requireRole('prime', 'sub', 'bhd_operator', 'assessor_read_only')(
      req as unknown as Request,
      resRead as unknown as Response,
      nextRead
    );
    expect(nextRead).toHaveBeenCalledOnce();
    expect(resRead.status).not.toHaveBeenCalled();

    // Rejected on write route (assessor_read_only excluded)
    const resWrite = mockRes();
    const nextWrite = vi.fn() as unknown as NextFunction;
    requireRole('prime', 'sub', 'bhd_operator')(
      req as unknown as Request,
      resWrite as unknown as Response,
      nextWrite
    );
    expect(nextWrite).not.toHaveBeenCalled();
    expect(resWrite.status).toHaveBeenCalledWith(403);
  });
});
