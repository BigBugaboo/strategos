# Releasing Strategos

Strategos releases are created automatically from the version in
`package.json`. A push to the repository's default `main` branch—normally the
result of merging a pull request—runs `.github/workflows/release.yml`.

## Release contract

1. A release pull request updates `package.json` and `package-lock.json` to the
   same valid semantic version.
2. CI and the release workflow verify the project with the Node.js version in
   `.node-version`.
3. If a GitHub Release named `v<version>` already exists, the workflow exits
   successfully without publishing a duplicate.
4. Otherwise the workflow creates the tag and GitHub Release from the merged
   default-branch commit and generates release notes from merged pull requests.
5. Versions containing a prerelease suffix, such as `1.0.0-beta.1`, are marked
   as prereleases. Other versions become the latest release.

The workflow can also be started manually with `workflow_dispatch` to retry a
failed or skipped release. If the tag exists without a corresponding GitHub
Release, the workflow verifies the existing tag and creates the missing
Release without moving the tag.

## Preparing a release

Choose the next semantic version and update both package files:

```bash
npm version 0.10.0 --no-git-tag-version
npm run verify
```

Commit the version change with the feature or fix, then merge it through a pull
request. Do not create or push the release tag locally; the release workflow
owns tag creation so that the tag always identifies a verified commit on the
default branch.
