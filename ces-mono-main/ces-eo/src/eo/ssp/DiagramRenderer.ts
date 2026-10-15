// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeTextArtifact } from 'ces-shared/persistence/files';

/**
 * Renders Mermaid diagram code to SVG and PNG formats using mermaid-cli (mmdc).
 * Provides graceful degradation if mmdc is not installed.
 */
export class DiagramRenderer {
  private readonly tempDir: string;
  private isMmdcAvailable: boolean | null = null;

  constructor(tempDir?: string) {
    this.tempDir = tempDir ?? path.join(os.tmpdir(), 'eo-diagrams');
    this.ensureTempDir();
  }

  /**
   * Check if mermaid-cli (mmdc) is installed and available
   */
  private checkMmdcAvailability(): boolean {
    if (this.isMmdcAvailable !== null) {
      return this.isMmdcAvailable;
    }

    try {
      execSync('mmdc --version', { stdio: 'pipe' });
      this.isMmdcAvailable = true;
      return true;
    } catch (error) {
      console.warn(
        '[DiagramRenderer] mermaid-cli (mmdc) not found. Diagram rendering will be skipped. ' +
        'To enable SVG rendering, install mermaid-cli: npm install -g @mermaid-js/mermaid-cli'
      );
      this.isMmdcAvailable = false;
      return false;
    }
  }

  /**
   * Ensure temporary directory exists
   */
  private ensureTempDir(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Render Mermaid code to SVG file
   * @param mermaidCode - Mermaid diagram syntax
   * @param outputPath - Absolute path for output SVG file
   * @returns Path to generated SVG file, or null if rendering failed
   */
  public renderMermaidToSvg(mermaidCode: string, outputPath: string): string | null {
    if (!this.checkMmdcAvailability()) {
      console.warn(`[DiagramRenderer] Skipping SVG rendering for ${path.basename(outputPath)} (mmdc not available)`);
      return null;
    }

    const tempMmdPath = path.join(this.tempDir, `diagram-${Date.now()}.mmd`);

    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write Mermaid code to temporary file
      writeTextArtifact(tempMmdPath, mermaidCode);

      // Execute mermaid-cli to render SVG
      // Options:
      //   -i: input file
      //   -o: output file
      //   -t: theme (neutral for professional look)
      //   -b: background (transparent)
      const command = `mmdc -i "${tempMmdPath}" -o "${outputPath}" -t neutral -b transparent`;

      execSync(command, { stdio: 'pipe' });

      // Verify SVG was created
      if (!fs.existsSync(outputPath)) {
        throw new Error(`SVG file not created at ${outputPath}`);
      }

      // Validate SVG content (basic check)
      const svgContent = fs.readFileSync(outputPath, 'utf-8');
      if (!svgContent.includes('<svg')) {
        throw new Error('Generated file is not valid SVG');
      }

      console.log(`[DiagramRenderer] Rendered SVG: ${outputPath}`);
      return outputPath;

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[DiagramRenderer] Mermaid SVG rendering failed: ${errMsg}`);
      return null;
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempMmdPath)) {
        fs.unlinkSync(tempMmdPath);
      }
    }
  }

  /**
   * Render Mermaid code to PNG file
   * @param mermaidCode - Mermaid diagram syntax
   * @param outputPath - Absolute path for output PNG file
   * @returns Path to generated PNG file, or null if rendering failed
   */
  public renderMermaidToPng(mermaidCode: string, outputPath: string): string | null {
    if (!this.checkMmdcAvailability()) {
      console.warn(`[DiagramRenderer] Skipping PNG rendering for ${path.basename(outputPath)} (mmdc not available)`);
      return null;
    }

    const tempMmdPath = path.join(this.tempDir, `diagram-${Date.now()}.mmd`);

    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write Mermaid code to temporary file
      writeTextArtifact(tempMmdPath, mermaidCode);

      // Execute mermaid-cli to render PNG
      const command = `mmdc -i "${tempMmdPath}" -o "${outputPath}" -t neutral -b transparent`;

      execSync(command, { stdio: 'pipe' });

      // Verify PNG was created
      if (!fs.existsSync(outputPath)) {
        throw new Error(`PNG file not created at ${outputPath}`);
      }

      console.log(`[DiagramRenderer] Rendered PNG: ${outputPath}`);
      return outputPath;

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[DiagramRenderer] Mermaid PNG rendering failed: ${errMsg}`);
      return null;
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempMmdPath)) {
        fs.unlinkSync(tempMmdPath);
      }
    }
  }

  /**
   * Convenience wrapper for rendering network architecture diagram to SVG
   * @param networkTopologyMermaid - Mermaid code for network topology
   * @returns Path to rendered SVG, or null if rendering failed
   */
  public renderNetworkDiagramToSvg(networkTopologyMermaid: string): string | null {
    const outputPath = path.join(this.tempDir, 'network-architecture.svg');
    return this.renderMermaidToSvg(networkTopologyMermaid, outputPath);
  }

  /**
   * Convenience wrapper for rendering data flow diagram to SVG
   * @param dataFlowMermaid - Mermaid code for data flow diagram
   * @returns Path to rendered SVG, or null if rendering failed
   */
  public renderDataFlowDiagramToSvg(dataFlowMermaid: string): string | null {
    const outputPath = path.join(this.tempDir, 'data-flow-diagram.svg');
    return this.renderMermaidToSvg(dataFlowMermaid, outputPath);
  }

  /**
   * Convenience wrapper for rendering authorization boundary diagram to SVG
   * @param authBoundaryMermaid - Mermaid code for authorization boundary
   * @returns Path to rendered SVG, or null if rendering failed
   */
  public renderAuthBoundaryDiagramToSvg(authBoundaryMermaid: string): string | null {
    const outputPath = path.join(this.tempDir, 'authorization-boundary.svg');
    return this.renderMermaidToSvg(authBoundaryMermaid, outputPath);
  }

  /**
   * Clean up temporary diagram files
   */
  public cleanup(): void {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          fs.unlinkSync(filePath);
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[DiagramRenderer] Cleanup failed: ${errMsg}`);
    }
  }
}
