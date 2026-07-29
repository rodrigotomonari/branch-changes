import * as assert from "assert";
import * as vscode from "vscode";
import { GitChangedFilesProvider } from "../views/git-changes-provider";
import { FileItem, FolderItem, FileStatus } from "../views/tree-items";
import { delay } from "../utils/workspace";
import { resetGitRepo, run, writeFile } from "./git-fixture";

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(
    folders && folders.length > 0,
    "expected a test workspace to be open"
  );
  return folders[0].uri.fsPath;
}

function findFile(
  items: vscode.TreeItem[],
  filePath: string
): FileItem | undefined {
  return items.find(
    (item): item is FileItem =>
      item instanceof FileItem && item.filePath === filePath
  );
}

suite("GitChangedFilesProvider", () => {
  let root: string;
  let provider: GitChangedFilesProvider;

  setup(() => {
    root = workspaceRoot();
    provider = new GitChangedFilesProvider();
    provider.selectedComparisonBranch = "main";
  });

  teardown(() => {
    provider.dispose();
    resetGitRepo(root);
  });

  test("shows only the branch selector when there are no changes", async () => {
    const items = await provider.getChildren();

    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].label, "main");
    assert.strictEqual(items[0].contextValue, "branchSelector");
    assert.strictEqual(items[1].label, "No changes detected");
  });

  test("classifies staged, unstaged, untracked, and committed files", async () => {
    run(root, "git checkout -q -b feature");
    writeFile(root, "feature.txt", "content");
    run(root, "git add feature.txt");
    run(root, 'git commit -q -m "add feature file"');

    writeFile(root, "README.md", "changed\n");
    writeFile(root, "staged.txt", "content");
    run(root, "git add staged.txt");
    writeFile(root, "untracked.txt", "content");

    const items = await provider.getChildren();

    assert.strictEqual(
      findFile(items, "feature.txt")?.status,
      FileStatus.COMMITTED
    );
    assert.strictEqual(
      findFile(items, "README.md")?.status,
      FileStatus.UNSTAGED
    );
    assert.strictEqual(
      findFile(items, "staged.txt")?.status,
      FileStatus.STAGED
    );
    assert.strictEqual(
      findFile(items, "untracked.txt")?.status,
      FileStatus.UNTRACKED
    );
  });

  test("groups files under nested folders", async () => {
    writeFile(root, "src/nested.txt", "content");

    const items = await provider.getChildren();
    const srcFolder = items.find(
      (item): item is FolderItem =>
        item instanceof FolderItem && item.name === "src"
    );

    assert.ok(srcFolder);
    const nestedFile = srcFolder!.children.get("nested.txt") as FileItem;
    assert.strictEqual(nestedFile.status, FileStatus.UNTRACKED);
  });

  test("getChildren returns a folder's own children when passed a FolderItem", async () => {
    const folder = new FolderItem("folder", "folder");
    const file = new FileItem("folder/a.txt", FileStatus.UNTRACKED, root);
    folder.children.set("a.txt", file);

    const children = await provider.getChildren(folder);

    assert.deepStrictEqual(children, [file]);
  });

  test("caches the tree until refresh() is called", async () => {
    await provider.getChildren();
    writeFile(root, "later.txt", "content");

    const beforeRefresh = await provider.getChildren();
    assert.strictEqual(findFile(beforeRefresh, "later.txt"), undefined);

    provider.refresh();
    const afterRefresh = await provider.getChildren();
    assert.ok(findFile(afterRefresh, "later.txt"));
  });

  test("concurrent getChildren() calls don't race on a half-built tree", async () => {
    writeFile(root, "untracked.txt", "content");

    // Regression test: buildFileTree() used to publish an empty rootFolder
    // synchronously before the git commands resolved, so a getChildren()
    // call that landed mid-build would see it as "already built" and
    // wrongly return "No changes detected".
    const [first, second] = await Promise.all([
      provider.getChildren(),
      provider.getChildren(),
    ]);

    assert.ok(findFile(first, "untracked.txt"));
    assert.ok(findFile(second, "untracked.txt"));
  });

  test("scheduleRefresh coalesces a burst of events into one refresh", async () => {
    await provider.getChildren();

    let refreshCount = 0;
    provider.onDidChangeTreeData(() => refreshCount++);

    // Stand in for the several watchers that all fire for one logical change.
    for (let i = 0; i < 10; i++) {
      provider.scheduleRefresh();
    }

    assert.strictEqual(refreshCount, 0, "should not refresh synchronously");

    await delay(600);
    assert.strictEqual(refreshCount, 1);
  });

  test("scheduleRefresh still rebuilds the tree", async () => {
    await provider.getChildren();
    writeFile(root, "later.txt", "content");

    provider.scheduleRefresh();
    await delay(600);

    assert.ok(findFile(await provider.getChildren(), "later.txt"));
  });

  test("refresh() supersedes a pending scheduled refresh", async () => {
    await provider.getChildren();

    let refreshCount = 0;
    provider.onDidChangeTreeData(() => refreshCount++);

    provider.scheduleRefresh();
    provider.refresh();

    assert.strictEqual(refreshCount, 1, "refresh() should fire immediately");

    await delay(600);
    assert.strictEqual(refreshCount, 1, "the queued refresh should be dropped");
  });

  test("selectComparisonBranch updates the selection and refreshes", async () => {
    run(root, "git branch feature");
    const originalShowQuickPick = vscode.window.showQuickPick;
    // showQuickPick opens a native modal picker that can't be driven by a
    // script, so it's stubbed here to simulate the user picking "feature".
    (vscode.window as { showQuickPick: unknown }).showQuickPick = async (
      items: { label: string }[]
    ) => items.find((item) => item.label === "feature");

    try {
      await provider.selectComparisonBranch();
    } finally {
      vscode.window.showQuickPick = originalShowQuickPick;
    }

    assert.strictEqual(provider.selectedComparisonBranch, "feature");
  });
});
