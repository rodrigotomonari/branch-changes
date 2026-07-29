import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

/**
 * Create an empty temp directory for use as a test fixture.
 */
export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "branch-changes-test-"));
}

/**
 * Create a temp directory initialized as a Git repo on a "main" branch,
 * with a local user configured so commits don't depend on global Git config.
 */
export function createTempGitRepo(): string {
  const dir = createTempDir();
  run(dir, "git init -q");
  run(dir, "git checkout -q -b main");
  run(dir, "git config user.email test@example.com");
  run(dir, 'git config user.name "Test User"');
  run(dir, "git config commit.gpgsign false");
  return dir;
}

/**
 * Give a fixture repo an "origin" remote whose default branch is
 * `defaultBranch`, without any network access: the remote-tracking ref and
 * origin/HEAD are written directly, which is the state `git clone` leaves
 * behind.
 */
export function addFakeOrigin(dir: string, defaultBranch: string): void {
  run(dir, "git remote add origin https://example.invalid/repo.git");
  run(dir, `git update-ref refs/remotes/origin/${defaultBranch} HEAD`);
  run(
    dir,
    `git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/${defaultBranch}`
  );
}

/**
 * Run a shell command in the given directory and return trimmed stdout.
 */
export function run(cwd: string, command: string): string {
  return execSync(command, { cwd, encoding: "utf8" }).trim();
}

/**
 * Write a file (creating parent directories as needed) inside a fixture directory.
 */
export function writeFile(
  dir: string,
  relativePath: string,
  content: string
): void {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/**
 * Recursively remove a fixture directory.
 */
export function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Restore a fixture repo created by createTempGitRepo() to a clean state on
 * "main", discarding any commits, branches, or working tree changes made by a
 * test. Used to reset a repo that's shared across tests (e.g. an opened
 * workspace folder) rather than recreated per test.
 */
export function resetGitRepo(dir: string): void {
  run(dir, "git checkout -q main");
  run(dir, "git reset -q --hard");
  run(dir, "git clean -q -fd");
  try {
    execSync("git branch -D feature", { cwd: dir, stdio: "ignore" });
  } catch {
    // "feature" branch may not exist; nothing to clean up.
  }
}
