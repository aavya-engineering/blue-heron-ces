// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as path from 'path';

/**
 * Options for embedding diagrams in DOCX
 */
export interface EmbedOptions {
  width?: number;      // Width in pixels
  height?: number;     // Height in pixels
  caption?: string;    // Figure caption text
}

/**
 * Embeds SVG/PNG diagram files into DOCX documents.
 * This module provides utilities for the SspDocxExporter to include rendered diagrams.
 *
 * Note: Actual DOCX embedding requires the docx library (ImageRun).
 * This module provides the interface and path validation logic.
 */
export class DiagramDocxEmbedder {

  /**
   * Embed SVG diagram in DOCX document
   * @param docxBuilder - DOCX document builder (from docx library)
   * @param svgPath - Absolute path to SVG file
   * @param options - Embedding options (width, height, caption)
   * @returns Object containing paragraph elements for the diagram and caption
   *
   * Note: This returns data structures that can be consumed by the docx library's
   * Document constructor. The actual DOCX generation is handled by SspDocxExporter.
   */
  public embedSvgInDocx(
    docxBuilder: any,
    svgPath: string,
    options: EmbedOptions = {}
  ): { imagePath: string; width: number; height: number; caption?: string } | null {

    // Validate SVG file exists
    if (!fs.existsSync(svgPath)) {
      console.error(`[DiagramDocxEmbedder] SVG file not found: ${svgPath}`);
      return null;
    }

    // Default dimensions (6 inches at 100 DPI = 600px)
    const width = options.width ?? 600;
    const height = options.height ?? 400;

    // SVG to PNG conversion for DOCX compatibility
    // The docx library supports PNG/JPEG natively, but not SVG
    // Check if PNG equivalent exists (should be created by DiagramRenderer)
    const pngPath = svgPath.replace('.svg', '.png');

    if (!fs.existsSync(pngPath)) {
      console.warn(
        `[DiagramDocxEmbedder] PNG version not found for ${path.basename(svgPath)}. ` +
        'SVG cannot be directly embedded in DOCX. Use DiagramRenderer.renderMermaidToPng() first.'
      );
      // Return SVG path anyway - caller may handle conversion
      return {
        imagePath: svgPath,
        width,
        height,
        caption: options.caption
      };
    }

    console.log(`[DiagramDocxEmbedder] Prepared diagram for embedding: ${path.basename(pngPath)}`);

    return {
      imagePath: pngPath,
      width,
      height,
      caption: options.caption
    };
  }

  /**
   * Convert SVG to PNG if PNG doesn't exist
   * This is a helper that delegates to DiagramRenderer for the actual conversion
   * @param svgPath - Path to SVG file
   * @returns Path to PNG file, or null if conversion failed
   */
  public ensurePngExists(svgPath: string): string | null {
    const pngPath = svgPath.replace('.svg', '.png');

    if (fs.existsSync(pngPath)) {
      return pngPath;
    }

    console.warn(
      `[DiagramDocxEmbedder] PNG not found for ${path.basename(svgPath)}. ` +
      'Caller should use DiagramRenderer.renderMermaidToPng() to generate PNG first.'
    );

    return null;
  }

  /**
   * Validate diagram file is suitable for DOCX embedding
   * @param filePath - Path to diagram file
   * @returns Validation result with any warnings
   */
  public validateDiagramFile(filePath: string): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    if (!fs.existsSync(filePath)) {
      return { valid: false, warnings: ['File does not exist'] };
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.svg') {
      warnings.push('SVG files require conversion to PNG for DOCX embedding');
      const pngPath = filePath.replace('.svg', '.png');
      if (!fs.existsSync(pngPath)) {
        warnings.push('PNG equivalent not found - conversion required');
      }
    } else if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
      return { valid: false, warnings: ['Unsupported file format (must be PNG, JPG, or SVG)'] };
    }

    const stats = fs.statSync(filePath);
    if (stats.size > 5 * 1024 * 1024) {
      warnings.push('File size exceeds 5MB - may cause DOCX bloat');
    }

    return { valid: true, warnings };
  }

  /**
   * Generate diagram metadata for SSP appendix
   * @param diagramPath - Path to diagram file
   * @param title - Diagram title
   * @param description - Diagram description
   * @returns Metadata object for SSP JSON
   */
  public generateDiagramMetadata(
    diagramPath: string,
    title: string,
    description: string
  ): { path: string; title: string; description: string; format: string; fileSize: number } | null {

    if (!fs.existsSync(diagramPath)) {
      console.error(`[DiagramDocxEmbedder] Cannot generate metadata - file not found: ${diagramPath}`);
      return null;
    }

    const stats = fs.statSync(diagramPath);
    const format = path.extname(diagramPath).substring(1).toUpperCase();

    return {
      path: diagramPath,
      title,
      description,
      format,
      fileSize: stats.size
    };
  }
}
