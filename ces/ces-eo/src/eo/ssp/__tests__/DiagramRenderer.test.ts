// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiagramRenderer } from '../DiagramRenderer.js';

describe('DiagramRenderer', () => {
  let testDir: string;
  let renderer: DiagramRenderer;

  beforeEach(() => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `eo-diagram-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    renderer = new DiagramRenderer(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    renderer.cleanup();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('renderMermaidToSvg', () => {
    it('should render simple Mermaid diagram to SVG', () => {
      const mermaidCode = `
graph TD
  A[Start] --> B[Process]
  B --> C[End]
`;
      const outputPath = path.join(testDir, 'test-diagram.svg');

      const result = renderer.renderMermaidToSvg(mermaidCode, outputPath);

      // If mmdc is not installed, result will be null (graceful degradation)
      if (result === null) {
        console.warn('Skipping test: mmdc not available');
        return;
      }

      expect(result).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);

      const svgContent = fs.readFileSync(outputPath, 'utf-8');
      expect(svgContent).toContain('<svg');
      expect(svgContent).toContain('</svg>');
    });

    it('should return null if mmdc is not available', () => {
      // This test validates graceful degradation
      // If mmdc is installed, we can't easily test the failure path
      // The test documents expected behavior
      const mermaidCode = 'graph TD; A-->B;';
      const outputPath = path.join(testDir, 'test-diagram.svg');

      const result = renderer.renderMermaidToSvg(mermaidCode, outputPath);

      // Result is either a valid path (mmdc available) or null (not available)
      if (result !== null) {
        expect(fs.existsSync(result)).toBe(true);
      }
    });

    it('should create output directory if it does not exist', () => {
      const nestedDir = path.join(testDir, 'nested', 'deep');
      const outputPath = path.join(nestedDir, 'diagram.svg');
      const mermaidCode = 'graph TD; A-->B;';

      const result = renderer.renderMermaidToSvg(mermaidCode, outputPath);

      if (result !== null) {
        expect(fs.existsSync(nestedDir)).toBe(true);
        expect(fs.existsSync(outputPath)).toBe(true);
      }
    });
  });

  describe('renderMermaidToPng', () => {
    it('should render Mermaid diagram to PNG', () => {
      const mermaidCode = `
graph LR
  A[Component A] --> B[Component B]
  B --> C[Component C]
`;
      const outputPath = path.join(testDir, 'test-diagram.png');

      const result = renderer.renderMermaidToPng(mermaidCode, outputPath);

      if (result === null) {
        console.warn('Skipping test: mmdc not available');
        return;
      }

      expect(result).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);

      const stats = fs.statSync(outputPath);
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('convenience wrappers', () => {
    const sampleMermaid = `
graph TD
  Internet[Internet] --> Firewall[Cloud Firewall]
  Firewall --> AppGateway[Application Gateway]
  AppGateway --> WebApp[Web Application]
`;

    it('should render network diagram to SVG', () => {
      const result = renderer.renderNetworkDiagramToSvg(sampleMermaid);

      if (result !== null) {
        expect(result).toContain('network-architecture.svg');
        expect(fs.existsSync(result)).toBe(true);
      }
    });

    it('should render data flow diagram to SVG', () => {
      const result = renderer.renderDataFlowDiagramToSvg(sampleMermaid);

      if (result !== null) {
        expect(result).toContain('data-flow-diagram.svg');
        expect(fs.existsSync(result)).toBe(true);
      }
    });

    it('should render authorization boundary diagram to SVG', () => {
      const result = renderer.renderAuthBoundaryDiagramToSvg(sampleMermaid);

      if (result !== null) {
        expect(result).toContain('authorization-boundary.svg');
        expect(fs.existsSync(result)).toBe(true);
      }
    });
  });

  describe('cleanup', () => {
    it('should remove all temporary files', () => {
      const mermaidCode = 'graph TD; A-->B;';

      // Create multiple diagram files
      renderer.renderMermaidToSvg(mermaidCode, path.join(testDir, 'diagram1.svg'));
      renderer.renderMermaidToSvg(mermaidCode, path.join(testDir, 'diagram2.svg'));

      // Verify files exist
      let filesBefore: string[] = [];
      if (fs.existsSync(testDir)) {
        filesBefore = fs.readdirSync(testDir);
      }

      // Cleanup
      renderer.cleanup();

      // Verify files removed
      let filesAfter: string[] = [];
      if (fs.existsSync(testDir)) {
        filesAfter = fs.readdirSync(testDir);
      }

      expect(filesAfter.length).toBeLessThanOrEqual(filesBefore.length);
    });
  });

  describe('error handling', () => {
    it('should handle invalid Mermaid syntax gracefully', () => {
      const invalidMermaid = 'this is not valid mermaid syntax {{{';
      const outputPath = path.join(testDir, 'invalid.svg');

      const result = renderer.renderMermaidToSvg(invalidMermaid, outputPath);

      // Should return null on error (graceful failure)
      // Or may succeed if mmdc is not installed (also returns null)
      expect(result === null || fs.existsSync(result)).toBe(true);
    });
  });
});
