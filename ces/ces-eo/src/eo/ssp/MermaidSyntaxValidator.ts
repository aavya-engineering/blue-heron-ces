// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Deterministic, dependency-light Mermaid SYNTAX validator.
 *
 * mmdc (mermaid-cli) is NOT installed in CI and a full visual render needs a
 * headless browser, so this validator performs a STATIC syntax check of the
 * specific diagram classes that DiagramGenerator emits:
 *
 *   1. Flowcharts:  `flowchart TB` / `graph TB` (and other valid directions)
 *      - valid header
 *      - balanced subgraph / end blocks
 *      - well-formed node declarations and `-->` edges
 *      - no edges that reference an undeclared node
 *
 *   2. Sequence diagrams: `sequenceDiagram`
 *      - valid header
 *      - well-formed `participant` declarations
 *      - well-formed message/arrow lines that target declared participants
 *
 * It uses NO jsdom / mermaid / browser dependencies (those are heavy + flaky in
 * CI). Full visual rendering is performed separately via mmdc (DiagramRenderer).
 *
 * Scope note: this is intentionally a pragmatic subset validator tuned to the
 * output of DiagramGenerator — it is not a full Mermaid grammar implementation.
 */

export interface MermaidValidationResult {
  valid: boolean;
  diagramType: 'flowchart' | 'sequenceDiagram' | 'unknown';
  errors: string[];
}

const VALID_FLOW_DIRECTIONS = new Set(['TB', 'TD', 'BT', 'RL', 'LR']);

export class MermaidSyntaxValidator {
  /**
   * Validate a Mermaid diagram string. Dispatches on the header keyword.
   */
  static validate(code: string): MermaidValidationResult {
    if (typeof code !== 'string' || code.trim().length === 0) {
      return { valid: false, diagramType: 'unknown', errors: ['Empty or non-string diagram input'] };
    }

    const lines = code
      .split('\n')
      .map(l => l.replace(/\r$/, ''))
      .filter(l => l.trim().length > 0);

    const header = lines[0].trim();

    if (header.startsWith('flowchart') || header.startsWith('graph')) {
      return this.validateFlowchart(lines);
    }
    if (header === 'sequenceDiagram') {
      return this.validateSequenceDiagram(lines);
    }

    return {
      valid: false,
      diagramType: 'unknown',
      errors: [`Unrecognized diagram header: "${header}". Expected "flowchart <DIR>", "graph <DIR>", or "sequenceDiagram".`],
    };
  }

  private static validateFlowchart(lines: string[]): MermaidValidationResult {
    const errors: string[] = [];
    const header = lines[0].trim();

    // Header: "flowchart TB" | "graph LR" | etc.
    const headerMatch = header.match(/^(flowchart|graph)\s+([A-Z]{2})$/);
    if (!headerMatch) {
      errors.push(`Invalid flowchart header: "${header}". Expected "flowchart <DIR>" or "graph <DIR>".`);
    } else if (!VALID_FLOW_DIRECTIONS.has(headerMatch[2])) {
      errors.push(`Invalid flowchart direction "${headerMatch[2]}". Valid: ${[...VALID_FLOW_DIRECTIONS].join(', ')}.`);
    }

    const declaredNodes = new Set<string>();
    const edgeRefs: Array<{ from: string; to: string; line: string }> = [];
    let subgraphDepth = 0;

    // Node id token: alphanumeric + underscore (matches DiagramGenerator.sanitizeId).
    const NODE_ID = '[A-Za-z0-9_]+';
    // Node declaration shapes emitted by DiagramGenerator:
    //   id["label"]  id(("label"))  id[("label")]  id{{"label"}}
    const nodeDeclRe = new RegExp(`^(${NODE_ID})\\s*(\\[\\(?".*?"\\)?\\]|\\(\\(".*?"\\)\\)|\\{\\{".*?"\\}\\})$`);
    // Edge: a --> b   (each side may carry an inline shape declaration too).
    const edgeRe = new RegExp(`^(${NODE_ID})(?:\\S.*?)?\\s*-->\\s*(${NODE_ID})(?:\\S.*?)?$`);
    const subgraphRe = new RegExp(`^subgraph\\s+(${NODE_ID})\\s*\\[".*?"\\]$`);

    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();

      if (subgraphRe.test(line)) {
        const id = line.match(subgraphRe)![1];
        declaredNodes.add(id);
        subgraphDepth++;
        continue;
      }
      if (line === 'end') {
        subgraphDepth--;
        if (subgraphDepth < 0) {
          errors.push(`Unbalanced "end" at line ${i + 1}: no matching "subgraph".`);
          subgraphDepth = 0;
        }
        continue;
      }
      if (line === 'direction TB' || /^direction\s+[A-Z]{2}$/.test(line)) {
        continue;
      }

      // Edge line.
      const edgeMatch = line.match(edgeRe);
      if (edgeMatch) {
        // Both endpoints may also declare a node shape inline; capture their ids.
        const fromId = this.extractLeadingNodeId(line);
        const toId = edgeMatch[2];
        // Register any inline-declared node shapes as declared.
        this.registerInlineDeclarations(line, declaredNodes);
        edgeRefs.push({ from: fromId, to: toId, line });
        continue;
      }

      // Node declaration line.
      if (nodeDeclRe.test(line)) {
        const id = line.match(nodeDeclRe)![1];
        declaredNodes.add(id);
        continue;
      }

      errors.push(`Malformed flowchart line ${i + 1}: "${line}"`);
    }

    if (subgraphDepth !== 0) {
      errors.push(`Unbalanced subgraph blocks: ${subgraphDepth} "subgraph" without matching "end".`);
    }

    // Dangling edge references (edge endpoint never declared as a node).
    for (const edge of edgeRefs) {
      if (!declaredNodes.has(edge.from)) {
        errors.push(`Edge references undeclared node "${edge.from}" in: "${edge.line}"`);
      }
      if (!declaredNodes.has(edge.to)) {
        errors.push(`Edge references undeclared node "${edge.to}" in: "${edge.line}"`);
      }
    }

    return { valid: errors.length === 0, diagramType: 'flowchart', errors };
  }

  private static validateSequenceDiagram(lines: string[]): MermaidValidationResult {
    const errors: string[] = [];
    const participants = new Set<string>();

    const NODE_ID = '[A-Za-z0-9_]+';
    const participantRe = new RegExp(`^participant\\s+(${NODE_ID})(?:\\s+as\\s+.+)?$`);
    // Messages: A->>B: text | A->>+B: text | A->>-B: text
    const messageRe = new RegExp(`^(${NODE_ID})->>[+-]?(${NODE_ID})\\s*:\\s*.+$`);
    const noteRe = new RegExp(`^Note\\s+(?:over|left of|right of)\\s+${NODE_ID}(?:,\\s*${NODE_ID})?\\s*:\\s*.+$`);

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();

      const pMatch = line.match(participantRe);
      if (pMatch) {
        participants.add(pMatch[1]);
        continue;
      }

      const mMatch = line.match(messageRe);
      if (mMatch) {
        if (!participants.has(mMatch[1])) {
          errors.push(`Message references undeclared participant "${mMatch[1]}" at line ${i + 1}: "${line}"`);
        }
        if (!participants.has(mMatch[2])) {
          errors.push(`Message references undeclared participant "${mMatch[2]}" at line ${i + 1}: "${line}"`);
        }
        continue;
      }

      if (noteRe.test(line)) {
        continue;
      }

      errors.push(`Malformed sequenceDiagram line ${i + 1}: "${line}"`);
    }

    if (participants.size === 0) {
      errors.push('sequenceDiagram declares no participants.');
    }

    return { valid: errors.length === 0, diagramType: 'sequenceDiagram', errors };
  }

  /** Extract the leading node id from an edge or node line. */
  private static extractLeadingNodeId(line: string): string {
    const m = line.match(/^([A-Za-z0-9_]+)/);
    return m ? m[1] : '';
  }

  /**
   * An edge line may declare node shapes inline on either endpoint, e.g.
   *   foo["Foo"] --> bar["Bar"]
   * Register every `id<shape>` token found so dangling-reference checks pass.
   */
  private static registerInlineDeclarations(line: string, declared: Set<string>): void {
    const inlineRe = /([A-Za-z0-9_]+)\s*(?:\[\(?".*?"\)?\]|\(\(".*?"\)\)|\{\{".*?"\}\})/g;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(line)) !== null) {
      declared.add(m[1]);
    }
  }
}
