import { exec, execFile } from "child_process";
import * as vscode from "vscode";
import { GitExtension, API } from "../git";
import { isGitRepository } from "../utils/workspace";

/**
 * Environment for every Git command we run.
 *
 * GIT_OPTIONAL_LOCKS=0 keeps read-only commands from taking the index lock and
 * writing a refreshed `.git/index`. Without it our own reads look like
 * repository activity to the built-in Git extension, which re-runs `git status`
 * and fires a state change, which makes us read again — a refresh loop.
 */
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };

/**
 * Execute a Git command and return the result as a Promise
 * @param command Git command to execute
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with command stdout
 */
export function executeGitCommand(
  command: string,
  workspaceRoot: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if we're in a Git repository before executing commands
    if (!isGitRepository(workspaceRoot)) {
      reject(new Error("Not a Git repository"));
      return;
    }

    console.log(`Executing Git command: ${command}`);

    exec(command, { cwd: workspaceRoot, env: GIT_ENV }, (error, stdout, stderr) => {
      if (error) {
        console.log("Git error:", error);
        console.log("stderr:", stderr);
        console.log("stdout:", stdout);
        reject(error);
        return;
      }

      resolve(stdout.trim());
    });
  });
}

/**
 * Get the current branch name
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with the current branch name
 */
export function getCurrentBranch(workspaceRoot: string): Promise<string> {
  // First check if we're in a Git repository
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve("Not a Git repository");
  }
  return executeGitCommand("git rev-parse --abbrev-ref HEAD", workspaceRoot);
}

/**
 * Get all available branches in the repository
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with an array of branch names
 */
export function getAllBranches(workspaceRoot: string): Promise<string[]> {
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve([]);
  }
  return executeGitCommand(
    'git branch --format="%(refname:short)"',
    workspaceRoot
  ).then((output) => output.split("\n").filter((b) => b.trim() !== ""));
}

/**
 * Branches to fall back on when the remote can't tell us its default,
 * in the order we prefer them.
 */
const CANDIDATE_BASE_BRANCHES = ["main", "master", "develop"];

/**
 * Get the remote to consult, preferring "origin" when several exist
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with the remote name, or null when there are no remotes
 */
async function getPreferredRemote(
  workspaceRoot: string
): Promise<string | null> {
  try {
    const remotes = (await executeGitCommand("git remote", workspaceRoot))
      .split("\n")
      .map((remote) => remote.trim())
      .filter((remote) => remote !== "");

    if (remotes.length === 0) {
      return null;
    }

    return remotes.includes("origin") ? "origin" : remotes[0];
  } catch {
    return null;
  }
}

/**
 * Get the branch the remote treats as its default, e.g. "origin/main".
 * Reads the local <remote>/HEAD ref that `git clone` sets up, so this never
 * touches the network.
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with the remote-tracking branch name, or null when
 *          <remote>/HEAD isn't set
 */
async function getRemoteDefaultBranch(
  workspaceRoot: string
): Promise<string | null> {
  const remote = await getPreferredRemote(workspaceRoot);

  if (!remote) {
    return null;
  }

  try {
    const branch = await executeGitCommand(
      `git symbolic-ref --short refs/remotes/${remote}/HEAD`,
      workspaceRoot
    );

    return branch.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check whether a local branch exists
 * @param workspaceRoot Path to the workspace root
 * @param branch Branch name to look for
 */
async function localBranchExists(
  workspaceRoot: string,
  branch: string
): Promise<boolean> {
  try {
    await executeGitCommand(
      `git rev-parse --verify --quiet refs/heads/${branch}`,
      workspaceRoot
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the default source branch to compare against
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with the default source branch name
 */
export async function getDefaultSourceBranch(
  workspaceRoot: string
): Promise<string> {
  if (!isGitRepository(workspaceRoot)) {
    return "main"; // Default when not in a Git repo
  }

  // The remote's default branch is what a merge request would target, so it is
  // the best answer when the repository knows it. Note this deliberately does
  // not consult the current branch's upstream: once a branch has been pushed
  // its upstream is its own remote-tracking branch, not the branch it forked
  // from.
  const remoteDefault = await getRemoteDefaultBranch(workspaceRoot);

  if (remoteDefault) {
    // Prefer the local branch of the same name, so the result matches an entry
    // in the branch picker (which only lists local branches). Strip just the
    // remote, keeping any slashes in the branch name itself.
    const localName = remoteDefault.replace(/^[^/]+\//, "");

    if (await localBranchExists(workspaceRoot, localName)) {
      return localName;
    }

    // No local counterpart, but a remote-tracking branch is still a perfectly
    // good revision to diff against.
    return remoteDefault;
  }

  // Nothing to ask, so try the conventional base branches. These are checked
  // in preference order; listing them in one `git branch` call would return
  // them sorted by name instead.
  for (const candidate of CANDIDATE_BASE_BRANCHES) {
    if (await localBranchExists(workspaceRoot, candidate)) {
      return candidate;
    }
  }

  return "main"; // Last resort
}

/**
 * Working tree state, split the way the tree view presents it
 */
export interface WorkingTreeChanges {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/**
 * Get the staged, unstaged, and untracked files in one pass.
 *
 * `git status --porcelain -z` answers all three at once, and unlike
 * `git diff --name-only` it never writes a refreshed index (see GIT_ENV), so
 * reading the tree can't be mistaken for repository activity. The -z form
 * emits NUL-separated records with literal, unquoted paths.
 * @param workspaceRoot Path to the workspace root
 */
export function getWorkingTreeChanges(
  workspaceRoot: string
): Promise<WorkingTreeChanges> {
  const changes: WorkingTreeChanges = {
    staged: [],
    unstaged: [],
    untracked: [],
  };

  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve(changes);
  }

  return new Promise((resolve) => {
    // execFile rather than executeGitCommand: the output must not be trimmed,
    // because the first status code of a line is a meaningful space.
    execFile(
      "git",
      // --untracked-files=all lists each untracked file; the default collapses
      // a new directory into a single "dir/" entry, which the tree can't show.
      ["status", "--porcelain", "-z", "--untracked-files=all"],
      { cwd: workspaceRoot, env: GIT_ENV, maxBuffer: 100 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          console.log("Git error getting working tree changes:", error);
          resolve(changes);
          return;
        }

        resolve(parseStatusRecords(stdout));
      }
    );
  });
}

/**
 * Parse the NUL-separated records of `git status --porcelain -z`
 * @param output Raw stdout of the status command
 */
function parseStatusRecords(output: string): WorkingTreeChanges {
  const changes: WorkingTreeChanges = {
    staged: [],
    unstaged: [],
    untracked: [],
  };

  const records = output.split("\0");

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Each record is "XY <path>": X is the index status, Y the working tree
    // status, either of which may be a space.
    if (record.length < 4) {
      continue;
    }

    const indexStatus = record[0];
    const workTreeStatus = record[1];
    const filePath = record.slice(3);

    if (indexStatus === "?" && workTreeStatus === "?") {
      changes.untracked.push(filePath);
      continue;
    }

    // A rename or copy is followed by an extra record holding the original
    // path, which we don't display; skip it so it isn't read as an entry.
    if (indexStatus === "R" || indexStatus === "C") {
      i++;
    }

    if (indexStatus !== " " && indexStatus !== "?") {
      changes.staged.push(filePath);
    }

    if (workTreeStatus !== " " && workTreeStatus !== "?") {
      changes.unstaged.push(filePath);
    }
  }

  console.log("Working tree changes:", changes);
  return changes;
}

/**
 * Get the common ancestor commit between HEAD and the source branch
 * @param workspaceRoot Path to the workspace root
 * @param sourceBranch Source branch to compare against
 * @returns Promise with the merge base commit hash, or null if it can't be found
 */
export function getMergeBase(
  workspaceRoot: string,
  sourceBranch: string
): Promise<string | null> {
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve(null);
  }

  return executeGitCommand(
    `git merge-base HEAD ${sourceBranch}`,
    workspaceRoot
  )
    .then((output) => output.trim() || null)
    .catch((error) => {
      console.log("Git error getting merge base:", error);
      return null;
    });
}

/**
 * Read the contents of a file as of a given Git revision.
 *
 * Unlike executeGitCommand this uses execFile (no shell, no trimming) because
 * the exact bytes matter for a diff: trailing newlines are significant and
 * paths must not be re-interpreted by the shell.
 * @param workspaceRoot Path to the workspace root
 * @param filePath Repository-relative path of the file
 * @param ref Git revision (commit hash or branch name)
 * @returns Promise with the file contents, or an empty string when the file
 *          does not exist at that revision
 */
export function getFileAtRevision(
  workspaceRoot: string,
  filePath: string,
  ref: string
): Promise<string> {
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    execFile(
      "git",
      ["show", `${ref}:${filePath}`],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        maxBuffer: 100 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          // The file doesn't exist at this revision, which is the normal case
          // for a file added on this branch. An empty left-hand side makes the
          // whole file read as added.
          console.log(`No content for ${filePath} at ${ref}:`, error.message);
          resolve("");
          return;
        }

        resolve(stdout);
      }
    );
  });
}

/**
 * Get files changed between current branch and source branch
 * @param workspaceRoot Path to the workspace root
 * @param sourceBranch Source branch to compare against
 * @returns Promise with an array of committed file paths
 */
export function getCommittedFiles(
  workspaceRoot: string,
  sourceBranch: string
): Promise<string[]> {
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve([]);
  }

  // The three-dot form means "changes on HEAD since it diverged from
  // sourceBranch", i.e. exactly `merge-base(sourceBranch, HEAD)..HEAD`, but in
  // a single command. Doing it in one command matters: `$(...)` substitution
  // isn't supported by cmd.exe on Windows, and when the substitution fails the
  // command silently degrades to `..HEAD`, which reports no changes at all.
  // The trailing `--` keeps a branch name from being read as a path.
  const gitCommand = `git diff --name-only ${sourceBranch}...HEAD --`;

  return executeGitCommand(gitCommand, workspaceRoot)
    .then((output) => {
      const files = output.split("\n").filter((line) => line !== "");
      console.log("Committed changed files:", files);
      return files;
    })
    .catch((error) => {
      vscode.window.showErrorMessage(
        "Error fetching changed files: " + error.message
      );
      return [];
    });
}

/**
 * Get the VS Code built-in Git API
 * @returns Promise with the Git API instance
 */
export async function getBuiltInGitApi(): Promise<API | undefined> {
  try {
    const extension = vscode.extensions.getExtension(
      "vscode.git"
    ) as vscode.Extension<GitExtension>;

    if (extension !== undefined) {
      const gitExtension = extension.isActive
        ? extension.exports
        : await extension.activate();

      return gitExtension.getAPI(1);
    }
  } catch (error) {
    console.error("Failed to get Git API:", error);
  }

  return undefined;
}
