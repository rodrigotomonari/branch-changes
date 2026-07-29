# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Branch Changes is a VS Code extension that shows a tree view of files changed (staged, unstaged, untracked, and committed vs. a comparison branch) in the Explorer panel, with a per-file button that opens a diff against the comparison branch.

## Commands

- `npm run compile` — type-check and build with `tsc` (output goes to `out/`)
- `npm run watch` — incremental build on file changes
- `npm run lint` — run ESLint on `src`
- `npm test` — runs `pretest` (compile + lint) then executes tests via `vscode-test`, which launches the extension in a real VS Code instance (no `--grep`-style single-test runner; tests live in `src/test/**/*.test.ts` and compile to `out/test/**/*.test.js`)

To manually try the extension, open this folder in VS Code and press F5 (launches an Extension Development Host), per `.vscode/launch.json`.

## Architecture

The extension has layers that build on each other:

1. **`src/git/git-utils.ts`** — low-level Git operations. Everything shells out via `child_process` (there is no library dependency on Git internals except for the VS Code built-in Git extension API, typed in `src/git.d.ts` and accessed via `getBuiltInGitApi()`). Key functions: `getCurrentBranch`, `getAllBranches`, `getDefaultSourceBranch` (reads `<remote>/HEAD`, else probes main/master/develop in that order), `getWorkingTreeChanges` (staged/unstaged/untracked in one `git status` call), `getCommittedFiles` (`git diff --name-only <sourceBranch>...HEAD`), `getMergeBase`, and `getFileAtRevision` (contents of a file at a commit, empty string when it didn't exist there).

   Two constraints apply to anything added here:

   - **Every command runs with `GIT_OPTIONAL_LOCKS=0`** (`GIT_ENV`). Without it, read-only commands like `git diff` rewrite `.git/index` when stat info is stale; the built-in Git extension sees that write, re-runs `git status`, fires a state change, and the view refreshes in a loop. Note `--no-optional-locks` does *not* cover `git diff`, and `git diff-files` (which avoids the write) reports touched-but-unchanged files as modified.
   - **No shell command substitution.** `exec` uses `cmd.exe` on Windows, where `$(...)` and `'…'` are not interpreted. Prefer a single git invocation (e.g. the three-dot diff) or `execFile`.

   `executeGitCommand` trims stdout, so commands whose output is whitespace-sensitive (`git status --porcelain`, file contents) use `execFile` directly instead.

2. **`src/git/branch-watcher.ts`** — wires up change detection through two redundant mechanisms registered in `setupGitBranchWatcher`: the VS Code Git API (subscribing to `state.onDidChange` for both already-open repositories and later `onDidOpenRepository` ones) and filesystem watchers on `.git/HEAD`, `.git/refs`, and the workspace root. The redundancy exists because file watchers are unreliable across OSes/filesystems for detecting git ref changes. The Git API fires after every `git status` it runs whether or not anything changed, so `fingerprintRepository` (HEAD, all refs, and the three change lists) filters out the no-ops.

3. **`src/views/git-changes-provider.ts`** (`GitChangedFilesProvider`) — implements `vscode.TreeDataProvider`. On `getChildren` at the root, it lazily builds a `FolderItem` tree (cached in `this.rootFolder`, invalidated by `refresh()`, with concurrent builds sharing one `buildPromise`) by merging the working-tree and committed file lists from git-utils into a nested folder structure via `FolderItem.addChild`. `selectComparisonBranch()` drives the branch-picker QuickPick and stores the choice in `selectedComparisonBranch`, which `getCommittedFiles` diffs against.

   `refresh()` rebuilds immediately and is for explicit user actions; **event handlers should call `scheduleRefresh()`**, which debounces by `REFRESH_DEBOUNCE_MS`. Several watchers fire for one logical change, and each rebuild costs a set of git commands.

4. **`src/views/tree-items.ts`** — `FileItem` (leaf, colored by `FileStatus` staged/unstaged/committed/untracked via `FileDecoration` badges S/U/C/?) and `FolderItem` (container, builds nested paths recursively).

5. **`src/git/diff.ts`** — backs the per-file diff button. `openFileDiff` opens `vscode.diff` with the file at the merge base on the left and the working-tree file on the right. The left side is served by our own `branch-changes:` read-only scheme (`registerRevisionContentProvider`) rather than the Git extension's `git:` scheme, which throws `FileNotFound` for a file that doesn't exist at the given revision — the normal case for a file added on the branch.

`src/extension.ts` ties it together: registers the tree provider under view id `gitChangedFilesView`, registers the revision content provider, registers the `gitChangedFiles.refresh`, `gitChangedFiles.selectBranch`, and `gitChangedFiles.openDiff` commands, and calls `treeDataProvider.scheduleRefresh()` on file save/create/delete/rename events, in addition to the watchers set up in branch-watcher.ts.

All workspace/git-repo-presence checks (`getWorkspaceRoot`, `isGitRepository`, `checkGitRepository`) live in `src/utils/workspace.ts` and are checked defensively at each entry point since the extension must degrade gracefully outside a Git workspace.
