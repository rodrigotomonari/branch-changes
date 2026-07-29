import * as vscode from "vscode";
import { checkGitRepository, delay } from "./utils/workspace";
import { GitChangedFilesProvider } from "./views/git-changes-provider";
import { setupGitBranchWatcher } from "./git/branch-watcher";
import { openFileDiff, registerRevisionContentProvider } from "./git/diff";
import { getDefaultSourceBranch } from "./git/git-utils";
import { FileItem } from "./views/tree-items";

/**
 * Main extension activation
 * @param context The extension context
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log("Git Changed Files extension activated");

  // Create tree data provider
  const treeDataProvider = new GitChangedFilesProvider();
  context.subscriptions.push(treeDataProvider);

  // Register the tree data provider for our view
  vscode.window.registerTreeDataProvider(
    "gitChangedFilesView",
    treeDataProvider
  );

  // Serve past revisions of files for the diff editor
  registerRevisionContentProvider(context);

  // Register commands
  registerCommands(context, treeDataProvider);

  // Set up file watchers for git repository changes. These all funnel into the
  // debounced refresh: they overlap by design, so a single change usually
  // trips more than one of them.
  await setupGitBranchWatcher(context, () =>
    treeDataProvider.scheduleRefresh()
  );

  // Set up workspace event listeners
  setupWorkspaceListeners(context, treeDataProvider);
}

/**
 * Register extension commands
 * @param context The extension context
 * @param treeDataProvider The tree data provider
 */
function registerCommands(
  context: vscode.ExtensionContext,
  treeDataProvider: GitChangedFilesProvider
): void {
  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("gitChangedFiles.refresh", () => {
      console.log("Refresh command triggered");
      treeDataProvider.refresh();
    })
  );

  // Register branch selection command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitChangedFiles.selectBranch",
      async () => {
        await treeDataProvider.selectComparisonBranch();
      }
    )
  );

  // Register the per-file diff command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitChangedFiles.openDiff",
      async (item: FileItem) => {
        if (!(item instanceof FileItem)) {
          return;
        }

        if (!checkGitRepository(item.workspaceRoot)) {
          return;
        }

        const comparisonBranch =
          treeDataProvider.selectedComparisonBranch ??
          (await getDefaultSourceBranch(item.workspaceRoot));

        try {
          await openFileDiff(item, comparisonBranch);
        } catch (error) {
          console.error("Error opening diff:", error);
          vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
        }
      }
    )
  );
}

/**
 * Set up listeners for workspace events
 * @param context The extension context
 * @param treeDataProvider The tree data provider
 */
function setupWorkspaceListeners(
  context: vscode.ExtensionContext,
  treeDataProvider: GitChangedFilesProvider
): void {
  // Refresh when files are saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      console.log("File saved:", document.fileName);
      treeDataProvider.scheduleRefresh();
    })
  );

  // Refresh when files are created, deleted or renamed
  setupFileChangeListeners(context, treeDataProvider);
}

/**
 * Set up listeners for file system changes
 * @param context The extension context
 * @param treeDataProvider The tree data provider
 */
function setupFileChangeListeners(
  context: vscode.ExtensionContext,
  treeDataProvider: GitChangedFilesProvider
): void {
  // File creation events
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(() => {
      console.log("Files created, refreshing view");
      treeDataProvider.scheduleRefresh();
    })
  );

  // File deletion events
  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles(() => {
      console.log("Files deleted, refreshing view");
      treeDataProvider.scheduleRefresh();
    })
  );

  // File rename events
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(() => {
      console.log("Files renamed, refreshing view");
      treeDataProvider.scheduleRefresh();
    })
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("Git Changed Files extension deactivated");
}
