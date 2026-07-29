import { exec, execFile } from "child_process";
import * as vscode from "vscode";
import { GitExtension, API } from "../git";
import { isGitRepository } from "../utils/workspace";

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

    exec(command, { cwd: workspaceRoot }, (error, stdout, stderr) => {
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
 * Detect the default source branch to compare against
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with the default source branch name
 */
export function getDefaultSourceBranch(workspaceRoot: string): Promise<string> {
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve("main"); // Default when not in a Git repo
  }

  return new Promise((resolve) => {
    // Try to get the tracking branch first
    executeGitCommand(
      "git for-each-ref --format='%(upstream:short)' \"$(git symbolic-ref -q HEAD)\"",
      workspaceRoot
    )
      .then((upstream) => {
        if (upstream) {
          // Remove remote part if present (e.g., origin/main -> main)
          const sourceBranch = upstream.includes("/")
            ? upstream.split("/")[1]
            : upstream;
          resolve(sourceBranch);
          return sourceBranch; // Return the value to maintain Promise chain
        }

        // If no tracking branch, look for common base branches
        return executeGitCommand(
          "git branch -l main master develop",
          workspaceRoot
        );
      })
      .then((branches) => {
        if (!branches) {
          resolve("main"); // Default fallback
          return;
        }

        const branchList = branches
          .split("\n")
          .map((b) => b.trim().replace("* ", ""))
          .filter((b) => b !== "");

        if (branchList.length > 0) {
          resolve(branchList[0]);
          return;
        }

        // Last resort
        resolve("main");
      })
      .catch(() => resolve("main")); // Default fallback on error
  });
}

/**
 * Get staged files in the repository
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with an array of staged file paths
 */
export function getStagedFiles(workspaceRoot: string): Promise<string[]> {
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve([]);
  }

  return executeGitCommand("git diff --name-only --cached", workspaceRoot)
    .then((output) => {
      const files = output.split("\n").filter((line) => line !== "");
      console.log("Staged files:", files);
      return files;
    })
    .catch((error) => {
      console.log("Git error getting staged files:", error);
      return [];
    });
}

/**
 * Get unstaged files in the repository
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with an array of unstaged file paths
 */
export function getUnstagedFiles(workspaceRoot: string): Promise<string[]> {
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve([]);
  }

  return executeGitCommand("git diff --name-only", workspaceRoot)
    .then((output) => {
      const files = output.split("\n").filter((line) => line !== "");
      console.log("Unstaged files:", files);
      return files;
    })
    .catch((error) => {
      console.log("Git error getting unstaged files:", error);
      return [];
    });
}

/**
 * Get untracked files in the repository
 * @param workspaceRoot Path to the workspace root
 * @returns Promise with an array of untracked file paths
 */
export function getUntrackedFiles(workspaceRoot: string): Promise<string[]> {
  if (!isGitRepository(workspaceRoot)) {
    return Promise.resolve([]);
  }

  return executeGitCommand(
    "git ls-files --others --exclude-standard",
    workspaceRoot
  )
    .then((output) => {
      const files = output.split("\n").filter((line) => line !== "");
      console.log("Untracked files:", files);
      return files;
    })
    .catch((error) => {
      console.log("Git error getting untracked files:", error);
      return [];
    });
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
