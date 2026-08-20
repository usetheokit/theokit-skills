# Releasing

Cutting a `v*` tag publishes. Nothing else does.

```bash
# on workspace, with the version already bumped and CHANGELOG.md updated
git tag v0.4.0
git push origin v0.4.0
```

The `release` workflow then runs the three-platform suite, checks four things, packs the tarball,
installs it into a clean project and runs the bin from it, and only then publishes.

## One-time setup

npm's trusted publishing removes the long-lived token entirely — the workflow authenticates with a
short-lived OIDC credential and provenance is generated automatically. It has one catch, and it is
structural: a trusted publisher is configured on a package's settings page, and that page does not
exist until the package has been published at least once. npm documents no way around it.

So the first release uses a token, and the token is deleted afterwards.

### 1. Bootstrap the first publish

Create a **granular access token** at <https://www.npmjs.com/settings/~/tokens> with write access to
`@theokit/*`, then:

```bash
gh secret set NPM_TOKEN --repo usetheokit/theokit-skills
```

Rehearse before committing to it — this runs every gate and packs the tarball without touching the
registry:

```bash
gh workflow run release.yml --repo usetheokit/theokit-skills -f dry_run=true
```

Then tag, as above.

### 2. Configure the trusted publisher

After the first version exists, at
<https://www.npmjs.com/package/@theokit/skills/access> → **Trusted Publisher** → **GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `usetheokit` |
| Repository | `theokit-skills` |
| Workflow filename | `release.yml` |
| Environment | `npm` |

### 3. Delete the token

```bash
gh secret delete NPM_TOKEN --repo usetheokit/theokit-skills
```

This step is the point of the previous one. A token left in place is a live credential nothing needs
any more — and the reason to prefer OIDC in the first place is that a credential which does not
exist cannot leak, expire at the wrong moment, or be rotated by someone who has left.

Confirm the next release still publishes: `NODE_AUTH_TOKEN` being unset is what makes npm fall back
to the OIDC credential.

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
