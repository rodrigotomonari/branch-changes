import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { delay, isGitRepository } from "../utils/workspace";
import { createTempDir, removeTempDir } from "./git-fixture";

suite("workspace utils", () => {
  let dir: string;

  setup(() => {
    dir = createTempDir();
  });

  teardown(() => {
    removeTempDir(dir);
  });

  test("isGitRepository returns true when a .git directory exists", () => {
    fs.mkdirSync(path.join(dir, ".git"));
    assert.strictEqual(isGitRepository(dir), true);
  });

  test("isGitRepository returns false when there is no .git directory", () => {
    assert.strictEqual(isGitRepository(dir), false);
  });

  test("delay resolves after roughly the requested time", async () => {
    const start = Date.now();
    await delay(20);
    assert.ok(Date.now() - start >= 15);
  });
});
