---
name: opencodex-upstream-sync
description: Synchronize this fork with lidge-jun/opencodex using a preserved-history merge, validate runtime, GUI, and docs, and optionally push dev and refresh the local ocx installation. Use for explicit upstream-sync or post-sync release workflows, not ordinary feature changes.
---

# OpenCodex upstream sync

Use this skill only for an explicit request to synchronize this fork with
https://github.com/lidge-jun/opencodex, or to carry out the explicitly
requested post-sync push and local installation refresh. The repository
AGENTS.md is authoritative; this file turns its sync procedure into a
repeatable runbook.

## Safety boundaries

- The normal source is an upstream stable release tag, not upstream/dev. Use
  upstream/dev only when the user explicitly names it. Record the exact source
  tag and commit before merging.
- Require a clean worktree before fetching, branching, or merging. Preserve the
  fork ancestry; never use hard reset, wholesale file replacement, forced rebase,
  or force push to make the trees match.
- Create a recoverable backup ref before the merge and keep it until the merged
  build has passed the requested operational verification.
- Resolve conflicts semantically against the current upstream architecture. Never
  blindly choose all of ours or all of theirs. Audit fork-maintained F-001
  through F-005 in AGENTS.md, including their security and regression contracts.
- git push, npm install -g ., and ocx restart mutate external state. Run them
  only when the current user request explicitly includes that action. A request
  to inspect, plan, or validate is not permission to push or restart.
- Do not answer any consent prompt printed by ocx start or service installation;
  relay it to the human instead.

## Phase 1: preflight and choose the source

Run from the repository root:

~~~bash
git status --short --branch
git branch --show-current
git remote -v
git remote get-url upstream
git remote get-url origin
~~~

The expected source remote is https://github.com/lidge-jun/opencodex.git.
Confirm the destination remote and branch before any push. The integration
branch is dev; feature sync work uses a temporary branch named
codex/sync-upstream-<version>. Stop if the worktree is dirty or the remotes
are not the intended ones.

Refresh upstream refs and tags, then select the highest non-preview stable tag
(vX.Y.Z) unless the user supplied an exact tag or commit:

~~~bash
git fetch upstream --tags --prune
git tag --sort=-version:refname
git rev-parse <stable-tag>^{commit}
git show -s --format='tag=%D%nsha=%H%ndate=%aI%nsubject=%s' <stable-tag>
~~~

Do not silently substitute a preview tag or a moving branch for the recorded
source.

## Phase 2: backup, branch, and three-way preview

From the current fork dev, create an explicit backup ref and a dedicated sync
branch. Use a unique date suffix; do not overwrite an existing backup ref.

~~~bash
git update-ref refs/codex-backups/dev-pre-sync-<version>-<YYYYMMDD> dev
git switch -c codex/sync-upstream-<version> dev
~~~

Record the three-way merge evidence before changing files:

~~~bash
base=$(git merge-base dev <stable-tag>)
printf 'common_ancestor=%s\n' "$base"
git rev-list --left-right --count dev...<stable-tag>
git diff --name-only "$base" dev | sort > /tmp/opencodex-sync-left.txt
git diff --name-only "$base" <stable-tag> | sort > /tmp/opencodex-sync-right.txt
comm -12 /tmp/opencodex-sync-left.txt /tmp/opencodex-sync-right.txt
git merge-tree --write-tree --messages dev <stable-tag>
~~~

The preview's non-zero status can mean predicted conflicts; inspect the
conflict paths and messages rather than treating the preview as the merge.

## Phase 3: merge and resolve

Merge with history preserved and without committing yet:

~~~bash
git merge --no-ff --no-commit <stable-tag>
~~~

Read the nearest nested AGENTS.md before editing files under src/, gui/,
docs-site/, scripts/, or .github/. Check both conflict markers and auto-merged
overlapping paths:

~~~bash
git diff --name-only --diff-filter=U
rg -n '^<<<<<<<|^=======|^>>>>>>>' .
git diff --check
~~~

If this check reports whitespace that came only from untouched upstream files,
record it and avoid mass-formatting the imported tree. Fix whitespace introduced
by your conflict resolution or other local edits.

Keep upstream additions while porting fork contracts onto the current
architecture. In particular, preserve Codex three-mode ownership, safe
client-metadata forwarding, OpenCode management authentication and modality
export, authoritative per-model output limits, and ZCode semantic ownership.
Add or retain focused regression tests for every intentional fork behavior.
After resolving, stage the complete merge and inspect the staged diff before
committing:

~~~bash
git add -A
git diff --cached --name-only --diff-filter=U
git diff --cached --check
git commit -m 'merge: sync upstream <version>'
~~~

If the merged tree is exactly a published release version and the release-line
test rejects a non-tag commit, advance package.json to the next development
version using the repository's existing version-bump convention, rerun the
version-line test, and keep that bump as a separate commit. Never leave dev
claiming an already-published version.

## Phase 4: validation gates

Run these after the merge and before pushing or reinstalling. A failed required
gate stops the workflow; report the exact failure instead of pushing a known-bad
tree.

~~~bash
# Root dependency lock
bun install --frozen-lockfile

# Runtime type safety
bun run typecheck

# Fork sentinels and changed-subsystem tests
bun test tests/codex-desired-state.test.ts tests/codex-sync-api.test.ts \
  tests/native-codex-toggle.test.ts tests/codex-metadata-integrity.test.ts \
  tests/codex-catalog.test.ts tests/catalog-input-modality-enum.test.ts \
  tests/client-config-export.test.ts tests/opencode-cli.test.ts \
  tests/management-client-config-route.test.ts tests/integrations-writer.test.ts

# Broad sync validation
bun run test

# Privacy gate
bun run privacy:scan

# CLI skill registry drift
bun run skill:surface:check
~~~

For a broad sync, run the GUI gates even when a conflict did not occur in GUI
files:

~~~bash
bun run lint:gui
cd gui && bun test tests
cd ..
bun run build:gui
~~~

build:gui intentionally performs another frozen install inside gui and then
runs the GUI build plus prepare:package; that nested install is expected, not
a lockfile mistake. It is especially required when a page, GUI component,
locale, or GUI dependency changed. If documentation changed, also run:

~~~bash
cd docs-site && bun install --frozen-lockfile && bun run build
~~~

Keep local environment failures separate from code failures. For example, a
privacy scan hit in a pre-existing ignored state file or DNS policy failures
from a local fake-IP resolver must be reported and not fixed by deleting user
state or weakening production SSRF policy.

## Phase 5: return to dev and push

After all required gates pass, verify the merge ancestry, clean tree, version,
and backup ref. Then fast-forward the integration branch; do not rewrite it:

~~~bash
git status --short --branch
git log --oneline --decorate --graph -5
git show-ref --verify refs/codex-backups/dev-pre-sync-<version>-<YYYYMMDD>
git switch dev
git merge --ff-only codex/sync-upstream-<version>
~~~

Only when the user explicitly asked to publish the synchronized code:

~~~bash
git status --short --branch
git push origin dev
~~~

Never add --force. If origin/dev moved, stop, fetch it, and re-audit the
ancestry and merge plan. Do not silently rebase away fork commits.

## Phase 6: refresh the local global installation

This phase is optional and requires explicit user authorization. Run it only
after the pushed/local tree is the intended clean commit:

~~~bash
command -v ocx
ocx --version
npm install -g .
rehash 2>/dev/null || hash -r 2>/dev/null || true
ocx --version
ocx restart
ocx ready --json
ocx status --json
~~~

npm install -g . installs from the current checkout and may run package
lifecycle hooks, including the package's prepack/prepare packaging path, so
repeated packaging output is possible. The explicit validation gates above are
still the source of truth; do not rely on an install lifecycle hook as proof.
Do not add --ignore-scripts for this package: its packaging flow prepares the
bundled runtime and generated entry points. Do not add sudo automatically; if
the configured npm prefix refuses the write, stop and let the user choose how
to handle permissions.

ocx restart is lifecycle-aware: it attests the running proxy, drains it, and
keeps managed service supervision in place. It can interrupt active requests.
If the global install fails because the operating system locks active package
files, use the documented fallback only after confirming ownership: ocx stop,
then install, then ocx start for a standalone proxy or ocx service start for a
service-managed proxy.

After restart, check that the reported version matches package.json and that
ocx ready --json and ocx status --json describe the new runtime. Keep the
backup ref until real startup, catalog ownership, and representative routing
verification are complete; remove it only as a separately reviewed cleanup.
