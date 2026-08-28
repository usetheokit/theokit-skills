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

## The plan a commit was written against

Plans live under `.claude/records/plans/`, which this repository never versions — `.claude/` is
installed tooling, not project source. So a plan has no history and no diff, and a plan edited after
the commit it governs is indistinguishable from one that was always right.

That is not hypothetical. During a review in 2026-08 the plan's mtime was **114 seconds after** the
commit it governed. Every acceptance criterion in it passed when executed, and nothing in the
repository could tell "the plan was corrected" from "the plan was moved to match what was built".

The commit **message** is versioned even when the file is not. So a commit that implements a plan
records its fingerprint as a trailer:

```
Plan-SHA256: 8f2c1a9b4e7d0356 (.claude/records/plans/my-slug-plan.md)
```

Generate it with `node scripts/plan-fingerprint.mjs <slug>`, and check a commit against the plan on
disk with:

```sh
node scripts/plan-fingerprint.mjs <slug> --verify "$(git log -1 --format=%b | sed -n 's/^Plan-SHA256: \([0-9a-f]*\).*/\1/p')"
```

Five answers, deliberately distinct, because they call for five different actions:

| exit | meaning | what to do |
|---|---|---|
| `0` | the plan is unchanged since the commit | nothing |
| `1` | it changed — **both** fingerprints are printed | read the plan and decide whether it was corrected or retrofitted |
| `2` | there is no readable plan for that slug | check the slug; the plan may be missing, unreadable, or outside the plans directory |
| `3` | the argument is not a fingerprint | a typo, or the `sed` matched something unexpected |
| `4` | the commit records no trailer | add one, or say in the commit why there is none |

A commit with no trailer is **not** a pass. It was never checked, and reporting "not a mismatch" for
it would be a clean result over an unverified state — which is the failure the whole mechanism
exists to make impossible.

`3` and `4` are separated for a practical reason: `--verify` is fed by a `sed` over the commit body,
and a commit with no trailer yields an **empty string**. Collapsing that into "malformed" sent the
reader to check their pipeline when the answer was about their commit.

### What this does not prove

The trailer proves the plan **has not changed since the commit**. It does **not prove the plan
existed before the work**: a plan written afterwards and committed with its own correct hash passes
cleanly. Detecting that would need a timestamp nobody in this repository controls, and no mechanism
here can supply one. A reader who believes the trailer proves more than this is worse off than one
who has no trailer at all.

It also depends on a human adding the line. An unfingerprinted commit reports `4`, which is a visible
gap rather than a silent one — but it is still a gap: nothing forces a commit that implements a plan
to carry a trailer.

And no digest length would change that. Widening the fingerprint from 16 hex characters to 64 would
buy nothing, because an adversary who wanted to hide what was built would simply **omit the
trailer** — the mechanism has no adversarial value at any length. What it defends against is an
accidental edit going unnoticed, and 64 bits is far more than that needs.

## Versioning

`0.x`, so a breaking change bumps the minor. `1.0.0` would claim a stability nothing has measured
yet; `.claude/rules/public-copy.md` covers why that claim needs evidence rather than a feeling.
