# Contributing

## Ownership & Roles

- **Owner:** Blue Heron Defense LLC and its licensors own this repository. See `LICENSE` and `TERMS.md`.
- **BHD maintainers** (`@blue-heron-defense-CES/bhd-maintainers`) review and approve every change to `main`. See `.github/CODEOWNERS`.
- **Partner developers** (`@blue-heron-defense-CES/partner-dev`) contribute changes for Blue Heron Defense LLC, at its direction, under `TERMS.md`.
- Submitting a change means you accept `TERMS.md`.
- No other use of this code is permitted.

## Workflow

1. Create a branch from `main`.
2. Make your change. Keep the ownership header in every file you touch.
3. Open a pull request. A BHD maintainer must approve it before it is merged.

## File header (required in every new source file)

Put this header at the top of each new source file, using that language's comment syntax. If the file has a shebang (`#!`) line, the header goes right after it. In HTML it goes after `<!doctype>`. In PowerShell use a `<# ... #>` block.

```
SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
SPDX-License-Identifier: LicenseRef-BHD-Proprietary
CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
Submitting a change to this repository means you accept TERMS.md.
Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
See LICENSE and TERMS.md.
```

Files that cannot carry a comment (JSON, Markdown, data files, migrations, templates, generated files, binaries) are labelled in `REUSE.toml` instead. Check with `reuse lint` before you open a pull request.

## Notices

Never remove or alter an ownership or confidentiality notice, in any file.

<!-- Pending counsel review -->
