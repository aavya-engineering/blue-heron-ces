// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as crypto from 'crypto';
import * as fs from 'fs';

export class HashingService {
  computeHash(data: string | Buffer): string {
    const hash = crypto.createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }

  computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  verifyHash(data: string | Buffer, expectedHash: string): boolean {
    const actualHash = this.computeHash(data);
    return actualHash === expectedHash;
  }

  async verifyFileHash(filePath: string, expectedHash: string): Promise<boolean> {
    const actualHash = await this.computeFileHash(filePath);
    return actualHash === expectedHash;
  }
}
