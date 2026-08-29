# CLAUDE.md — mcp-exec

Project-specific working agreements. These are binding for any agent working in this repo.

## Handling pull request review feedback

This applies to feedback from human reviewers and from automated reviewers
(Codex, Copilot, etc.) alike. Automated reviewers are not authoritative — they
are frequently right and occasionally wrong, so every finding gets judged on the
evidence, never accepted or dismissed on the strength of who filed it.

For **every** review thread on a PR you own, do all of the following:

### 1. Reproduce before you judge

Do not reason about the claim from the diff alone. Run the code and observe the
behavior the reviewer describes — typically by comparing the PR build against
the merge base:

```bash
node -e 'const {Thing} = require("./dist/…"); /* exercise the claim */'
node -e 'const {Thing} = require("/path/to/main/checkout/dist/…"); /* same */'
```

Capture the actual output. It decides whether you fix, and it is the evidence
you quote back to the reviewer. A finding you cannot reproduce is a finding you
must not silently "fix".

### 2. Fix, and push to the PR branch

If the finding is valid, fix it on the same branch and push. Add a regression
test that fails without the fix — the test belongs with the fix, in the same
commit. Keep the commit message specific about what was reported and what
changed.

If fixing the reported problem reveals the same defect one level deeper, fix
that too and say so in your reply; do not quietly expand beyond that.

### 3. Reply in the thread, with details

Reply to the thread itself (not a top-level PR comment) via:

```bash
gh api -X POST repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies -F body=@reply.md
```

The reply must state:
- the commit SHA that addresses it,
- the reproduction you ran and its **actual output**,
- what changed and why that resolves the finding,
- which test now covers it,
- any deliberate deviation from what the reviewer proposed, and the reasoning.

Never reply with a bare "fixed" or "done".

### 4. Resolve — only threads you actually fixed

```bash
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<PRRT_…>"}) { thread { isResolved } } }'
```

Thread IDs come from the `reviewThreads` GraphQL query. Resolve **after** the
reply is posted, never before, and never as a way to clear feedback you did not
act on.

### 5. If you decline to fix — explain, and leave it unresolved

Declining is legitimate: the finding may be wrong, may describe intended
behavior, or may be correctly out of scope for the PR. When you decline:

- post the reasoning as a reply in the thread, including the evidence that led
  you there (the reproduction that did not reproduce, the design constraint, the
  scope boundary),
- **leave the thread unresolved** so a human can arbitrate,
- if it is a real problem that simply belongs elsewhere, file an issue and link
  it in the reply.

A declined finding is never closed by silence.

### 6. Report what you did

When you finish, list per thread: fixed + resolved, or declined + left open with
the reason. Do not claim a thread is resolved without having called the
mutation.

## Reviewing a pull request

**Always post review feedback as comments on the PR.** A review that exists only
in a chat transcript is not a review — the author cannot see it, act on it, or
reply to it. This holds no matter who asked for the review or how informal it
looks.

Post findings as **inline review comments anchored to the line they concern**,
in a single review:

```bash
gh api -X POST repos/<owner>/<repo>/pulls/<pr>/reviews --input review.json
```

where `review.json` carries `commit_id`, a summary `body`, and a `comments`
array of `{path, line, side: "RIGHT", body}`. Use `"event": "COMMENT"` —
GitHub rejects `APPROVE` / `REQUEST_CHANGES` on your own PR, which is the common
case here.

The same evidence standard as the section above applies, in both directions:

- **Run the branch; do not review the diff alone.** Check the change out, build
  it, execute it. Every finding you post should name the command you ran and
  quote its actual output. The findings that matter most are usually the ones a
  diff cannot show — a guard that looks correct but never fires, a test that
  passes for the wrong reason.
- **Verify an automated reviewer's findings before relaying them.** Codex and
  similar tools are often right and sometimes wrong, and they occasionally cite
  files or symbols that are not on the branch. Reproduce each finding yourself;
  drop the ones that do not hold up, and say so.
- **Triage instead of dumping.** Order findings by how much they matter, and
  state briefly what you considered and deliberately set aside, so the author
  can ask for those if they want them.
- **Say what is right, too.** If the PR meets its issue's acceptance criteria,
  confirm that explicitly with the evidence — the author should not have to
  guess whether you checked.

## Working in parallel worktrees

When several agents work in git worktrees of this repo at once, parts of the
checkout are shared and will corrupt each other's work:

- **Never use `git stash`** (or `stash pop` / `apply` / `drop` / `clear`). The
  stash stack lives in the shared `.git` directory, so every worktree sees the
  same entries — agents have popped each other's work into the wrong trees here
  before. To A/B test: `git diff > /tmp/mine.patch`, `git restore <files>`, then
  `git apply /tmp/mine.patch`; or commit WIP on your own branch.
- **Use a private `mktemp -d` for PR bodies and commit messages.** The session
  scratchpad is shared, and a generic filename like `pr-body.md` has already
  caused one PR to be created with another agent's text. Verify after creating:
  `gh pr view <n> --json body`.
- **Check `git status` before committing** and confirm every dirty file is in
  your scope; `git restore` anything that is not yours. Stage explicit paths —
  never `git add -A` or `git commit -a`.
- **Bind ephemeral ports** (port `0`) in tests, never a fixed one, and point
  `MCP_EXEC_LOG_DIR` and any session file at an `fs.mkdtemp` directory rather
  than `~/.mcp-exec` or the repo root.

## Build and test notes

- `dist/` is listed in `.gitignore` but 44 files are still tracked from before
  that rule, so `npm run build` dirties tracked files in every worktree. Default
  to leaving rebuilt `dist/` out of commits and rebuilding after merge; if a
  branch already commits a `dist/` file, keep it consistent rather than leaving
  it stale against its `src/`.
- `npm test` is a build smoke test, not a unit suite. Individual suites are
  separate `test:*` scripts, aggregated by `test:all`; wire any new test in
  there.
- Verify a new regression test actually fails without the fix. A test that
  cannot fail is worse than no test.
