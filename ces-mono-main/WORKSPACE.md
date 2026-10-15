# CES workspace layout

CES is five repositories that must sit in one folder layout. Several packages depend on each other through relative `file:../` paths, so the layout is required, not optional.

```
ces/                     <- blue-heron-defense-CES/ces-mono (this repo)
  ces-shared/            (in ces-mono)
  ces-stamper/           (in ces-mono)
  ces-ao/  ces-eo/  ces-ec/  ces-planner/  tenant-tests/   (in ces-mono)
  ces-tenant/            <- blue-heron-defense-CES/ces-tenant
  ces-muster/            <- blue-heron-defense-CES/ces-muster
  ces-tester/            <- blue-heron-defense-CES/ces-tester
  tenant-stacksim/       <- blue-heron-defense-CES/ces-stacksim
```

`ces-mono`'s `.gitignore` already ignores the four nested repositories.

## Cross-repo dependencies

| Package | Depends on |
|---|---|
| `ces-ao`, `ces-ec`, `ces-stamper` | `file:../ces-tenant` |
| `ces-eo` | `file:../ces-tenant`, `file:../ces-shared` |
| `ces-muster/muster-api` | `file:../../ces-shared`, `file:../../ces-tenant` |
| `ces-tester` | `file:../ces-tenant` |

Some tests in `ces-tester`, `ces-muster` and `tenant-stacksim` also read sibling folders by relative path.

## Set up

Requirements: Git, Node.js 20+ and npm, and access to the `blue-heron-defense-CES` organization.

- Windows: `pwsh scripts/bootstrap.ps1 -Root C:\path\to\ces`
- macOS/Linux: `sh scripts/bootstrap.sh /path/to/ces`

The script clones the five repositories into the layout above, installs dependencies in the right order (`ces-tenant` is built first, because the other packages link to its `dist/`), builds `ces-shared` and `ces-stamper`, and runs each package's tests. It reports each package's result and keeps going if one fails.

## Live tenants

There is no live tenant access by default. Use the simulator (`tenant-stacksim`) for development and tests.
