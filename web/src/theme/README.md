# Theme Token Contract

Synchronize uses layered design tokens rendered as CSS custom properties.

The public model is not "N fixed colors". It is:

1. Primitive palette values per theme.
2. Semantic roles such as `--surface`, `--fg`, `--rule`, and `--accent`.
3. Identity slots such as `--identity-0-bg`, `--identity-0-fg`, and `--identity-0-border`.
4. Component roles such as `--activity-control-bg` and `--composer-send-border`.

TypeScript carries color references (`IdentityColorRef`) and persistence
migrations. CSS owns the actual theme values.

Default agent and room colors should use identity slots. Custom hex colors are
allowed, but they are explicit overrides, not the deterministic default path.
