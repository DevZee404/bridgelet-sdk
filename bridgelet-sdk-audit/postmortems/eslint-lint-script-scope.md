# Postmortem: ESLint Lint Script Scope

## Issue Summary

The `lint` script in `package.json` uses an explicit glob that only targets TypeScript files within specific directories, leaving many project files outside ESLint's reach. Contributors may assume the lint command covers the entire repository, leading to uncaught issues in overlooked paths.

## Root Cause

The lint script is defined as:

```
eslint "{src,apps,libs,test}/**/*.ts" --fix
```

This glob explicitly restricts linting to `*.ts` files inside `src/`, `apps/`, `libs/`, and `test/`. Files that fall outside this scope include:

- Root-level configuration files (`*.js`, `*.json`, `*.ts` at the project root)
- Non-TypeScript source files (`*.md`, `*.yml`, `*.yaml`, `*.sh`, `*.css`)
- Any TypeScript files in directories not listed in the glob (e.g., `scripts/`, `bridgelet-sdk-audit/`)

A contributor unfamiliar with this detail might run `npm run lint` expecting comprehensive coverage and believe the codebase is clean, when in fact files outside the glob are never checked.

## Resolution

No code change is required; this is a documentation-only finding. The lint script's glob is intentional—it keeps lint fast and focused on application code. The important takeaway is that contributors should be aware of the script's actual scope rather than assuming it covers the full repository.

## Action Items

- [ ] Add a comment in `package.json` or a note in `CONTRIBUTING.md` clarifying the lint script's explicit glob scope.
- [ ] Consider whether additional scripts or a broader ESLint config (e.g., `.eslintrc` with `ignorePatterns`) would benefit the project as it grows.
