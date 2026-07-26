# Formatting and Lint Scope Checklist

## Formatting

- [ ] Is `prettier` configured and integrated in the pre-commit hooks?
- [ ] Are markdown files included in the prettier scope?
- [ ] Is there a CI check to enforce formatting on all PRs?

## Linting

- [ ] Is `eslint` configured with strict typing rules for TypeScript?
- [ ] Are there rules to prevent `console.log` in production code?
- [ ] Is the lint scope correctly applying to all `src/` and `test/` directories?
