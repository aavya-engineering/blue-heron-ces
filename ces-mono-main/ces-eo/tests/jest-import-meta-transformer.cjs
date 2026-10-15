// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * ts-jest AST transformer: makes ESM `import.meta` source CommonJS-safe under jest.
 *
 * EO source modules are authored as ESM and use `import.meta.url` (e.g. for
 * `createRequire(import.meta.url)`), and several declare module-scope ESM shims
 * `const __filename = ...` / `const __dirname = ...`. Under jest, ts-jest compiles to
 * CommonJS, where (a) `import.meta` is a parse/runtime error and (b) `__filename` /
 * `__dirname` are already injected by the module wrapper — so the shims collide.
 *
 * This transformer:
 *   1. Replaces every `import.meta.url` with `require('url').pathToFileURL(__filename).href`
 *      (same file URL at runtime under CommonJS).
 *   2. Drops top-level `const __filename = ...` / `const __dirname = ...` declarations so the
 *      wrapper-provided values are used instead of redeclaring them.
 *
 * Test-only — production builds (tsc, module=NodeNext) are unaffected.
 */
const ts = require('typescript');

const name = 'import-meta-url';
const version = 1;

const factory = () => {
  return (ctx) => (sourceFile) => {
    const isShimName = (n) => n === '__filename' || n === '__dirname';

    // Drop top-level `const __filename = ...` / `const __dirname = ...` statements that would
    // collide with the CommonJS module-wrapper-provided identifiers.
    const filteredStatements = sourceFile.statements.filter((stmt) => {
      if (
        ts.isVariableStatement(stmt) &&
        stmt.declarationList.declarations.every(
          (d) => ts.isIdentifier(d.name) && isShimName(d.name.text)
        )
      ) {
        return false;
      }
      return true;
    });
    sourceFile = ctx.factory.updateSourceFile(sourceFile, filteredStatements);

    const visit = (node) => {
      // Match `import.meta.url`
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === 'url' &&
        ts.isMetaProperty(node.expression) &&
        node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
      ) {
        // require('url').pathToFileURL(__filename).href
        return ctx.factory.createPropertyAccessExpression(
          ctx.factory.createCallExpression(
            ctx.factory.createPropertyAccessExpression(
              ctx.factory.createCallExpression(
                ctx.factory.createIdentifier('require'),
                undefined,
                [ctx.factory.createStringLiteral('url')]
              ),
              'pathToFileURL'
            ),
            undefined,
            [ctx.factory.createIdentifier('__filename')]
          ),
          'href'
        );
      }
      return ts.visitEachChild(node, visit, ctx);
    };
    return ts.visitNode(sourceFile, visit);
  };
};

module.exports = { name, version, factory };
