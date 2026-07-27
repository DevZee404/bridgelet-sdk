# Postmortem: No .prettierignore — Full Repository Scan

## Issue Summary

The `format:check` script runs `prettier --check .`, which scans the entire repository for formatting violations. The project has no `.prettierignore` file, meaning every file—including documentation, generated artifacts, and third-party content—is subject to Prettier's formatting rules.

## Root Cause

Without a `.prettierignore`, Prettier treats the current directory (`.`) as its full scope. This means:

- Markdown files (`*.md`), YAML configs (`*.yml`), and other non-code files are checked and may fail formatting if they contain intentionally formatted content.
- Any generated artifacts or vendored files committed to the repository will be scanned, potentially producing noisy failures.
- Contributors adding new documentation or configuration files may be surprised by unexpected formatting requirements.

In practice this can slow down CI and create friction for contributors who add files that were not intended to be formatted.

## Resolution

This is a documentation-only finding. Whether to add a `.prettierignore` depends on the project's goals:

- **Adding `.prettierignore`** is worthwhile when the repository contains files where formatting consistency is not important (e.g., `*.lock`, generated files, vendored assets) or where Prettier's output would be undesirable.
- **Keeping full-repo formatting** is a valid default for small, well-curated repositories where consistency across all files is valued and the scan cost is negligible.

The decision should be documented so future contributors understand the expectation.

## Action Items

- [ ] Decide whether a `.prettierignore` is appropriate for this repository and add one if so.
- [ ] Document the formatting scope expectation in `CONTRIBUTING.md` or a similar guide.
