import * as vscode from "vscode";
import * as path from "path";
import { FileItem, FileStatus } from "../views/tree-items";
import { getFileAtRevision, getMergeBase } from "./git-utils";

/**
 * URI scheme for read-only documents holding a file at a past revision.
 * We serve these ourselves rather than reusing the built-in Git extension's
 * `git:` scheme, which fails outright when a file does not exist at the given
 * revision — exactly the case for a file added on the current branch.
 */
export const REVISION_SCHEME = "branch-changes";

interface RevisionQuery {
  workspaceRoot: string;
  filePath: string;
  ref: string;
}

/**
 * Build a URI that our content provider resolves to the file at a revision.
 * The path keeps the original file extension so VS Code still picks the right
 * language for syntax highlighting.
 * @param item The file item being diffed
 * @param ref Git revision to read the file at
 */
function toRevisionUri(item: FileItem, ref: string): vscode.Uri {
  const query: RevisionQuery = {
    workspaceRoot: item.workspaceRoot,
    filePath: item.filePath,
    ref,
  };

  return vscode.Uri.from({
    scheme: REVISION_SCHEME,
    path: `/${item.filePath}`,
    query: JSON.stringify(query),
  });
}

/**
 * Register the content provider backing the left-hand side of our diffs
 * @param context The extension context
 */
export function registerRevisionContentProvider(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(REVISION_SCHEME, {
      provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const { workspaceRoot, filePath, ref } = JSON.parse(
          uri.query
        ) as RevisionQuery;

        return getFileAtRevision(workspaceRoot, filePath, ref);
      },
    })
  );
}

/**
 * Check whether a file currently exists on disk
 * @param fileUri URI of the file to check
 */
async function fileExists(fileUri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(fileUri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a diff editor showing everything that changed in a file on this branch
 * (committed, staged and unstaged) compared with the comparison branch.
 * @param item The file item to diff
 * @param comparisonBranch Branch the current branch is being compared against
 */
export async function openFileDiff(
  item: FileItem,
  comparisonBranch: string
): Promise<void> {
  const fileUri = vscode.Uri.file(path.join(item.workspaceRoot, item.filePath));
  const fileName = path.basename(item.filePath);

  // Untracked files have no previous version to diff against
  if (item.status === FileStatus.UNTRACKED) {
    await vscode.commands.executeCommand("vscode.open", fileUri);
    return;
  }

  const mergeBase = await getMergeBase(item.workspaceRoot, comparisonBranch);

  if (!mergeBase) {
    vscode.window.showErrorMessage(
      `Could not find a common ancestor between HEAD and ${comparisonBranch}.`
    );
    return;
  }

  // A file deleted from the working tree can't be shown on the right-hand
  // side, so fall back to its HEAD contents (empty if it was deleted in a
  // commit too, which reads as a full deletion).
  const rightUri = (await fileExists(fileUri))
    ? fileUri
    : toRevisionUri(item, "HEAD");

  await vscode.commands.executeCommand(
    "vscode.diff",
    toRevisionUri(item, mergeBase),
    rightUri,
    `${fileName} (${comparisonBranch} ↔ Working Tree)`,
    { preview: true } as vscode.TextDocumentShowOptions
  );
}
