# Releasing

Cutting a `v*` tag publishes. Nothing else does.

```bash
# on workspace, with the version already bumped and CHANGELOG.md updated
git tag v0.4.0
git push origin v0.4.0
```

The `release` workflow then runs the three-platform suite, checks four things, packs the tarball,
installs it into a clean project and runs the bin from it, and only then publishes.

## Authentication: nothing to configure

Publishing authenticates over **OIDC trusted publishing**. There is no token, no secret in the
repository, and nothing to rotate: npm mints a short-lived credential from the workflow's OIDC token
and generates provenance automatically.

The trusted publisher is already configured on the package:

| Field | Value |
| --- | --- |
| Organization or user | `usetheokit` |
| Repository | `theokit-skills` |
| Workflow filename | `release.yml` |
| Environment | `npm` |

Change any of those three names — rename the repo, rename the workflow file, move the publish job
out of the `npm` environment — and publishing stops working until the trusted publisher is updated
to match. That is the trade: the credential cannot leak because it does not exist, and in exchange
the identity of the workflow *is* the credential.

<details>
<summary>How the first release got published, and why that path is closed</summary>

A trusted publisher is configured on a package's settings page, and that page does not exist until
the package has been published at least once. npm documents no way around the circularity, so
`v0.4.0` was published with a temporary granular token scoped to `@theokit`, which was revoked
immediately afterwards — both the GitHub secret and the token itself, since deleting the secret does
not revoke the credential.

Do not recreate it. Beyond being unnecessary now, npm is restricting bypass-2FA tokens: account
changes from August 2026 and direct publishing from January 2027.

</details>

## The `npm` environment

`release.yml` runs its publish job in a GitHub environment named `npm`, for two reasons. The trusted
publisher configuration can pin it, so a workflow running outside that environment cannot publish
even from this repository. And it is where a required reviewer goes if you ever want a human
approval between the tag and the registry — Settings → Environments → `npm` → required reviewers.

## What the pipeline refuses to do

- Publish from a tag whose number disagrees with `package.json` — that ships one version under
  another's name.
- Publish a version with no `## [x.y.z]` section in `CHANGELOG.md` (Unbreakable Rule 6).
- Publish a version that already exists. npm versions are immutable, and the native error for this
  is about the wrong thing.
- Publish a tarball it has not installed and run. `npm test` proves the source works; only the pack
  step proves that what `files[]` ships works, and that is the half that breaks.

Every gate runs before the publish step, and the three-platform suite runs before all of them —
repeated there rather than assumed, because a tag can be cut from any commit, including one that
never passed the branch gate.

## Versioning

`0.x`, so a breaking change bumps the minor. `1.0.0` would claim a stability nothing has measured
yet; `.claude/rules/public-copy.md` covers why that claim needs evidence rather than a feeling.
