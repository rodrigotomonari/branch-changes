import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { FileItem, FolderItem, FileStatus } from "../views/tree-items";

suite("FolderItem", () => {
  test("adds a top-level file directly as a child", () => {
    const root = new FolderItem("root", "");
    const file = new FileItem("a.txt", FileStatus.STAGED, "/workspace");

    root.addChild(["a.txt"], file);

    assert.strictEqual(root.children.get("a.txt"), file);
  });

  test("creates intermediate folders for nested paths", () => {
    const root = new FolderItem("root", "");
    const file = new FileItem(
      "src/utils/a.ts",
      FileStatus.UNSTAGED,
      "/workspace"
    );

    root.addChild(["src", "utils", "a.ts"], file);

    const srcFolder = root.children.get("src") as FolderItem;
    assert.ok(srcFolder instanceof FolderItem);
    const utilsFolder = srcFolder.children.get("utils") as FolderItem;
    assert.ok(utilsFolder instanceof FolderItem);
    assert.strictEqual(utilsFolder.children.get("a.ts"), file);
  });

  test("reuses an existing folder when adding a sibling file", () => {
    const root = new FolderItem("root", "");
    const fileA = new FileItem("src/a.ts", FileStatus.STAGED, "/workspace");
    const fileB = new FileItem("src/b.ts", FileStatus.UNSTAGED, "/workspace");

    root.addChild(["src", "a.ts"], fileA);
    root.addChild(["src", "b.ts"], fileB);

    const srcFolder = root.children.get("src") as FolderItem;
    assert.strictEqual(srcFolder.children.size, 2);
    assert.strictEqual(srcFolder.children.get("a.ts"), fileA);
    assert.strictEqual(srcFolder.children.get("b.ts"), fileB);
  });
});

suite("FileItem", () => {
  test("uses the file's base name as its label", () => {
    const item = new FileItem(
      "src/utils/workspace.ts",
      FileStatus.COMMITTED,
      "/workspace"
    );

    assert.strictEqual(item.label, "workspace.ts");
  });

  test("points resourceUri at the full workspace-relative path and opens on click", () => {
    const item = new FileItem("src/a.ts", FileStatus.STAGED, "/workspace");
    const expected = vscode.Uri.file(path.join("/workspace", "src/a.ts"));

    assert.strictEqual(item.resourceUri?.fsPath, expected.fsPath);
    assert.strictEqual(item.command?.command, "vscode.open");
  });

  test("sets a distinct badge and contextValue per status", () => {
    const staged = new FileItem("a.ts", FileStatus.STAGED, "/workspace");
    const unstaged = new FileItem("a.ts", FileStatus.UNSTAGED, "/workspace");
    const committed = new FileItem("a.ts", FileStatus.COMMITTED, "/workspace");
    const untracked = new FileItem(
      "a.ts",
      FileStatus.UNTRACKED,
      "/workspace"
    );

    assert.strictEqual(staged.contextValue, "stagedFile");
    assert.strictEqual(unstaged.contextValue, "unstagedFile");
    assert.strictEqual(committed.contextValue, "committedFile");
    assert.strictEqual(untracked.contextValue, "untrackedFile");

    assert.strictEqual(staged.decorations?.[0].badge, "S");
    assert.strictEqual(unstaged.decorations?.[0].badge, "U");
    assert.strictEqual(committed.decorations?.[0].badge, "C");
    assert.strictEqual(untracked.decorations?.[0].badge, "?");
  });
});
