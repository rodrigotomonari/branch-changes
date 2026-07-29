import { defineConfig } from '@vscode/test-cli';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function run(cwd, command) {
	execSync(command, { cwd, stdio: 'ignore' });
}

/**
 * Creates a throwaway Git repo to open as the test workspace, so tests that
 * rely on vscode.workspace.workspaceFolders (the provider, the branch watcher)
 * can run against a real repository instead of needing an open workspace to be
 * faked.
 */
function createFixtureWorkspace() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-changes-workspace-'));
	run(dir, 'git init -q');
	run(dir, 'git checkout -q -b main');
	run(dir, 'git config user.email test@example.com');
	run(dir, 'git config user.name "Test User"');
	run(dir, 'git config commit.gpgsign false');
	fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
	run(dir, 'git add README.md');
	run(dir, 'git commit -q -m "initial commit"');
	return dir;
}

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: createFixtureWorkspace(),
});
