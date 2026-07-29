import * as assert from "assert";
import * as vscode from "vscode";
import { setupGitBranchWatcher } from "../git/branch-watcher";
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
    // Dispose everything, most importantly the fallback poller's setInterval,
    // so it doesn't keep firing (and keep the process alive) after the test.
    context.subscriptions.forEach((subscription) => subscription.dispose());
    resetGitRepo(root);
  });

  test("registers file watchers and a fallback poller for a real Git repository", async function () {
    this.timeout(10000);

    await setupGitBranchWatcher(
      context as unknown as vscode.ExtensionContext,
      () => {},
      () => "main"
    );

    // Git HEAD watcher, project root watcher, refs directory watcher, and the
    // fallback branch poller.
    assert.strictEqual(context.subscriptions.length, 4);
  });
});
