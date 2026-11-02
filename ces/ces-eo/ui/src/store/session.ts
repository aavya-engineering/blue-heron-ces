// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The console session: the selected tenant, the last assessment snapshot, and the access tokens.
// Tokens are held in memory only (never localStorage or sessionStorage): a reload signs the
// browser out, which is the safe default for credentials.
//   serviceToken  EO's bearer (CES_EO_AUTH_TOKEN), sent as Authorization on every /api call
//   operatorToken a BHD operator session or token, sent as x-ces-principal to the two issuers only
//   uploaderToken an EC uploader token (minted for a named uploader), sent with uploads
//   approverToken a minted approver token (names the reviewer), sent with reviews

import { create } from 'zustand';
import { setServiceToken } from '../api/http';
import type { ConnectionState } from '../api/types';

export interface SessionState {
  tenant: string | null;
  lastSnapshotId: string | null;
  serviceToken: string;
  operatorToken: string;
  uploaderToken: string;
  approverToken: string;
  /** FIN-31b: the optional live connect (GET /api/connect) for the selected tenant; reset on tenant change. */
  connection: ConnectionState;
  connectionText: string;
  setConnection: (state: ConnectionState, text: string) => void;
  setTenant: (slug: string | null) => void;
  setSnapshot: (id: string | null) => void;
  setServiceToken: (t: string) => void;
  setOperatorToken: (t: string) => void;
  setUploaderToken: (t: string) => void;
  setApproverToken: (t: string) => void;
  reset: () => void;
}

const initial = {
  tenant: null, lastSnapshotId: null, serviceToken: '', operatorToken: '', uploaderToken: '', approverToken: '',
  connection: 'idle' as ConnectionState, connectionText: 'Not connected',
};

export const useSession = create<SessionState>((set) => ({
  ...initial,
  setTenant: (tenant) => set({ tenant: tenant || null, lastSnapshotId: null, connection: 'idle', connectionText: 'Not connected' }),
  setConnection: (connection, connectionText) => set({ connection, connectionText }),
  setSnapshot: (lastSnapshotId) => set({ lastSnapshotId }),
  setServiceToken: (serviceToken) => {
    setServiceToken(serviceToken);
    set({ serviceToken });
  },
  setOperatorToken: (operatorToken) => set({ operatorToken }),
  setUploaderToken: (uploaderToken) => set({ uploaderToken }),
  setApproverToken: (approverToken) => set({ approverToken }),
  reset: () => {
    setServiceToken(null);
    set({ ...initial });
  },
}));
