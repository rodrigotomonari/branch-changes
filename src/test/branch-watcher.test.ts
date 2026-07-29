import * as assert from "assert";
import * as vscode from "vscode";
import { setupGitBranchWatcher } from "../git/branch-watcher";
import { getBuiltInGitApi } from "../git/git-utils";
import { resetGitRepo } from "./git-fixture";

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(
    folders && folders.length > 0,
    "expected a test workspace to be open"
  );
  return folders[0].uri.fsPath;
}

suite("setupGitBranchWatcher", () => {
  let root: string;
  let context: { subscriptions: vscode.Disposable[] };

  setup(() => {
    root = workspaceRoot();
    context = { subscriptions: [] };
  });

  teardown(() => {
    // Dispose the watchers so they don't keep firing after the test.
    context.subscriptions.forEach((subscription) => subscription.dispose());
    resetGitRepo(root);
  });

  test("registers file and Git API watchers for a real Git repository", async function () {
    this.timeout(10000);

    await setupGitBranchWatcher(
      context as unknown as vscode.ExtensionContext,
      () => {}
    );

    // Git HEAD watcher, project root watcher, refs directory watcher, and the
    // onDidOpenRepository subscription, plus a state listener for every
    // repository the Git extension has already opened (however many it has
    // finished scanning by now).
    const gitAPI = await getBuiltInGitApi();
    const openRepositories = gitAPI?.repositories.length ?? 0;

    assert.strictEqual(context.subscriptions.length, 4 + openRepositories);
  });
});
