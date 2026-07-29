import * as assert from "assert";
import {
  getCurrentBranch,
  getAllBranches,
  getDefaultSourceBranch,
  getStagedFiles,
  getUnstagedFiles,
  getUntrackedFiles,
  getCommittedFiles,
  getMergeBase,
  getFileAtRevision,
} from "../git/git-utils";
import { isGitRepository } from "../utils/workspace";
import {
  createTempDir,
  createTempGitRepo,
  removeTempDir,
  run,
  writeFile,
} from "./git-fixture";

suite("git-utils", () => {
  let repoDir: string;

  setup(() => {
    repoDir = createTempGitRepo();
    writeFile(repoDir, "README.md", "hello\n");
    run(repoDir, "git add README.md");
    run(repoDir, 'git commit -q -m "initial commit"');
  });

  teardown(() => {
    removeTempDir(repoDir);
  });

  test("isGitRepository detects the .git directory", () => {
    assert.strictEqual(isGitRepository(repoDir), true);
  });

  test("getCurrentBranch returns the checked-out branch", async () => {
    assert.strictEqual(await getCurrentBranch(repoDir), "main");
  });

  test("getAllBranches lists every local branch", async () => {
    run(repoDir, "git branch feature");
    const branches = await getAllBranches(repoDir);
    assert.deepStrictEqual(branches.sort(), ["feature", "main"]);
  });

  test("getStagedFiles returns files added to the index but not committed", async () => {
    writeFile(repoDir, "staged.txt", "content");
    run(repoDir, "git add staged.txt");
    assert.deepStrictEqual(await getStagedFiles(repoDir), ["staged.txt"]);
  });

  test("getUnstagedFiles returns modified tracked files", async () => {
    writeFile(repoDir, "README.md", "changed\n");
    assert.deepStrictEqual(await getUnstagedFiles(repoDir), ["README.md"]);
  });

  test("getUntrackedFiles returns files git doesn't know about", async () => {
    writeFile(repoDir, "untracked.txt", "content");
    assert.deepStrictEqual(await getUntrackedFiles(repoDir), [
      "untracked.txt",
    ]);
  });

  test("getCommittedFiles diffs against the merge base of the source branch", async () => {
    run(repoDir, "git checkout -q -b feature");
    writeFile(repoDir, "feature.txt", "content");
    run(repoDir, "git add feature.txt");
    run(repoDir, 'git commit -q -m "add feature file"');

    assert.deepStrictEqual(await getCommittedFiles(repoDir, "main"), [
      "feature.txt",
    ]);
  });

  test("getMergeBase returns the commit the branch diverged from", async () => {
    const baseCommit = run(repoDir, "git rev-parse HEAD");
    run(repoDir, "git checkout -q -b feature");
    writeFile(repoDir, "feature.txt", "content");
    run(repoDir, "git add feature.txt");
    run(repoDir, 'git commit -q -m "add feature file"');

    assert.strictEqual(await getMergeBase(repoDir, "main"), baseCommit);
  });

  test("getMergeBase returns null for an unknown branch", async () => {
    assert.strictEqual(await getMergeBase(repoDir, "no-such-branch"), null);
  });

  test("getFileAtRevision returns the file contents at that revision", async () => {
    writeFile(repoDir, "README.md", "changed\n");

    assert.strictEqual(
      await getFileAtRevision(repoDir, "README.md", "HEAD"),
      "hello\n"
    );
  });

  test("getFileAtRevision returns an empty string for a file added later", async () => {
    const baseCommit = run(repoDir, "git rev-parse HEAD");
    writeFile(repoDir, "added.txt", "new file\n");
    run(repoDir, "git add added.txt");
    run(repoDir, 'git commit -q -m "add file"');

    assert.strictEqual(
      await getFileAtRevision(repoDir, "added.txt", baseCommit),
      ""
    );
  });

  test("getFileAtRevision handles paths with spaces", async () => {
    writeFile(repoDir, "with space.txt", "spaced\n");
    run(repoDir, 'git add "with space.txt"');
    run(repoDir, 'git commit -q -m "add spaced file"');

    assert.strictEqual(
      await getFileAtRevision(repoDir, "with space.txt", "HEAD"),
      "spaced\n"
    );
  });

  test("getDefaultSourceBranch falls back to main when there is no upstream", async () => {
    run(repoDir, "git checkout -q -b feature");
    assert.strictEqual(await getDefaultSourceBranch(repoDir), "main");
  });
});

suite("git-utils outside a repository", () => {
  let plainDir: string;

  setup(() => {
    plainDir = createTempDir();
  });

  teardown(() => {
    removeTempDir(plainDir);
  });

  test("isGitRepository returns false without a .git directory", () => {
    assert.strictEqual(isGitRepository(plainDir), false);
  });

  test("getAllBranches resolves to an empty array", async () => {
    assert.deepStrictEqual(await getAllBranches(plainDir), []);
  });

  test("getDefaultSourceBranch resolves to main", async () => {
    assert.strictEqual(await getDefaultSourceBranch(plainDir), "main");
  });

  test("getMergeBase resolves to null", async () => {
    assert.strictEqual(await getMergeBase(plainDir, "main"), null);
  });

  test("getFileAtRevision resolves to an empty string", async () => {
    assert.strictEqual(
      await getFileAtRevision(plainDir, "README.md", "HEAD"),
      ""
    );
  });
});
