# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Branch Changes is a VS Code extension that shows a tree view of files changed (staged, unstaged, and committed vs. a comparison branch) in the Explorer panel.

## Commands

- `npm run compile` — type-check and build with `tsc` (output goes to `out/`)
- `npm run watch` — incremental build on file changes
- `npm run lint` — run ESLint on `src`
- `npm test` — runs `pretest` (compile + lint) then executes tests via `vscode-test`, which launches the extension in a real VS Code instance (no `--grep`-style single-test runner; tests live in `src/test/**/*.test.ts` and compile to `out/test/**/*.test.js`)

To manually try the extension, open this folder in VS Code and press F5 (launches an Extension Development Host), per `.vscode/launch.json`.

## Architecture

The extension has three layers that build on each other:

1. **`src/git/git-utils.ts`** — low-level Git operations. Everything shells out via `child_process.exec` (there is no library dependency on Git internals except for the VS Code built-in Git extension API, typed in `src/git.d.ts` and accessed via `getBuiltInGitApi()`). Key functions: `getCurrentBranch`, `getAllBranches`, `getDefaultSourceBranch` (auto-detects upstream or falls back to main/master/develop), `getStagedFiles`, `getUnstagedFiles`, `getCommittedFiles` (diffs against `git merge-base HEAD <sourceBranch>`).

2. **`src/git/branch-watcher.ts`** — wires up change detection through three redundant mechanisms registered in `setupGitBranchWatcher`: the VS Code Git API's `onDidChange`, filesystem watchers on `.git/HEAD` and `.git/refs`, and a 5-second polling fallback comparing `git rev-parse --abbrev-ref HEAD` against the last known branch. This redundancy exists because file watchers are unreliable across OSes/filesystems for detecting git ref changes.

3. **`src/views/git-changes-provider.ts`** (`GitChangedFilesProvider`) — implements `vscode.TreeDataProvider`. On `getChildren` at the root, it lazily builds a `FolderItem` tree (cached in `this.rootFolder`, invalidated by `refresh()`) by merging staged/unstaged/committed file lists from git-utils into a nested folder structure via `FolderItem.addChild`. `selectComparisonBranch()` drives the branch-picker QuickPick and stores the choice in `selectedComparisonBranch`, which `getCommittedFiles` diffs against.

4. **`src/views/tree-items.ts`** — `FileItem` (leaf, colored by `FileStatus` staged/unstaged/committed via `FileDecoration` badges S/U/C) and `FolderItem` (container, builds nested paths recursively).

`src/extension.ts` ties it together: registers the tree provider under view id `gitChangedFilesView`, registers the `gitChangedFiles.refresh` and `gitChangedFiles.selectBranch` commands, and calls `treeDataProvider.refresh()` on editor changes, file save/create/delete/rename events (with a small delay to let git settle), in addition to the watchers set up in branch-watcher.ts.

All workspace/git-repo-presence checks (`getWorkspaceRoot`, `isGitRepository`, `checkGitRepository`) live in `src/utils/workspace.ts` and are checked defensively at each entry point since the extension must degrade gracefully outside a Git workspace.
