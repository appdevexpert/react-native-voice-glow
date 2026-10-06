# Contributing

Pull requests are welcome. Before opening one:

```sh
npm install
npm run typecheck
npm test
```

`npm test` paints every scene through real Skia and compares it with the original web component pixel by pixel, so a visual change that drifts from the original fails here. The example app in `example/` is the quickest way to see a change on a device.

Please leave the version in `package.json` alone in your pull request; the maintainer bumps it when cutting a release.

## Releasing (maintainers)

Releases happen on GitHub; nothing is run locally.

- **Merging a pull request into `main` releases the next patch version** (0.1.0 → 0.1.1). Before merging, add the label `release:minor` or `release:major` for a bigger bump, or `skip-release` to merge without releasing (for example a README-only change).
- **To release on demand**, open Actions → Release → Run workflow, pick patch, minor or major, and run it. Tick "Dry run" to run the checks and build without publishing.
- To release an exact version, edit the `version` in `package.json` on GitHub and commit it to `main`, then use Run workflow. A version in `package.json` that is newer than npm is released as is.

Each release (`.github/workflows/publish.yml`) runs the checks, publishes to npm with provenance through npm trusted publishing (no npm token is stored), commits the new version back to `main`, tags it `vX.Y.Z` and creates a GitHub release with notes generated from the merged pull requests. If a release fails, nothing is committed; fix the cause and use Run workflow.
