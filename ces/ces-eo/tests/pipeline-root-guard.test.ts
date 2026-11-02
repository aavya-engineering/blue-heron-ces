/**
 * W5 cycle 7 (test hygiene, harness check V10): under jest, the CES pipeline root that the repository and the
 * stores resolve is the per-run temporary root that tests/jest-global-setup.cjs pins, never the production
 * default `%LOCALAPPDATA%\CES\pipeline` nor anywhere else in `%LOCALAPPDATA%` outside the OS temp folder.
 * (On Windows the OS temp folder is `%LOCALAPPDATA%\Temp`, where the pinned root lives.)
 */
import { describe, it, expect } from '@jest/globals';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCesPipelineRoot } from '../../ces-shared/src/storage/node';
import { getCesDbPath } from '../../ces-shared/src/persistence/CesRepository';

const norm = (p: string) => path.resolve(p).toLowerCase();
const inside = (child: string, parent: string) => {
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

describe('test pipeline root (V10 hygiene)', () => {
  it('CES_PIPELINE_ROOT is pinned by the global setup to a per-run temporary directory', () => {
    const pinned = process.env.CES_EO_TEST_PIPELINE_ROOT;
    expect(pinned).toBeTruthy();
    expect(path.basename(pinned!)).toMatch(/^eo-jest-pipeline-/);
    expect(inside(pinned!, os.tmpdir())).toBe(true);
    expect(norm(getCesPipelineRoot())).toBe(norm(pinned!));
    expect(inside(getCesDbPath(), pinned!)).toBe(true);
  });

  it('the resolved root lies outside %LOCALAPPDATA% (the OS temp folder excepted) and outside %LOCALAPPDATA%\\CES', () => {
    const local = process.env.LOCALAPPDATA;
    const root = getCesPipelineRoot();
    if (local) {
      expect(inside(root, path.join(local, 'CES'))).toBe(false);
      expect(inside(root, local) && !inside(root, os.tmpdir())).toBe(false);
    }
    expect(norm(root)).not.toBe(norm(path.join(local ?? path.join(os.homedir(), 'AppData', 'Local'), 'CES', 'pipeline')));
  });
});
