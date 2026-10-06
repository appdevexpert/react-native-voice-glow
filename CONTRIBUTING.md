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

Every push to `main` runs `.github/workflows/publish.yml`. It publishes to npm only when the version in `package.json` is not on npm yet, so merging a pull request on its own does not release anything.

To release what is on `main`:

```sh
npm version patch   # or minor / major; commits the bump and tags it
git push --follow-tags
```

The workflow then runs the checks, publishes the new version to npm (with provenance, through npm trusted publishing, no token stored), and creates a GitHub release with notes generated from the merged pull requests. A pre-release version such as `0.2.0-beta.1` is published under the `next` tag instead of `latest`.
