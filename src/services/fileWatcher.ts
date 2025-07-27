import * as vscode from 'vscode';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { SyncService } from './syncService';

export class FileWatcher implements vscode.Disposable {
    private watcher: chokidar.FSWatcher | null = null;
    private syncTimer: NodeJS.Timeout | null = null;
    private pendingFiles = new Set<string>();

    constructor(private syncService: SyncService) {}

    start(): void {
        const config = vscode.workspace.getConfiguration('mobilecoder');
        const autoSync = config.get<boolean>('autoSync', true);
        
        if (!autoSync) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const syncDir = config.get<string>('syncDirectory') || workspaceFolder.uri.fsPath;
        const syncPath = path.isAbsolute(syncDir) ? syncDir : path.join(workspaceFolder.uri.fsPath, syncDir);

        this.watcher = chokidar.watch(syncPath, {
            ignored: [
                /(^|[\/\\])\../, // ignore dotfiles
                /node_modules/,  // ignore node_modules
                /\.git/          // ignore .git
            ],
            persistent: true,
            ignoreInitial: true
        });

        this.watcher.on('change', (filePath: string) => {
            this.onFileChanged(filePath);
        });

        this.watcher.on('add', (filePath: string) => {
            this.onFileChanged(filePath);
        });

        console.log(`MobileCoder: Started watching ${syncPath} for file changes`);
    }

    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }

        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }

        this.pendingFiles.clear();
        console.log('MobileCoder: Stopped file watching');
    }

    private onFileChanged(filePath: string): void {
        const config = vscode.workspace.getConfiguration('mobilecoder');
        const syncInterval = config.get<number>('syncInterval', 5); // Default 5 seconds

        if (syncInterval <= 0) {
            return; // Auto sync disabled
        }

        // Add to pending files
        this.pendingFiles.add(filePath);

        // Clear existing timer and set new one
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
        }

        this.syncTimer = setTimeout(() => {
            this.syncPendingFiles();
        }, syncInterval * 1000);
    }

    private async syncPendingFiles(): Promise<void> {
        if (this.pendingFiles.size === 0) {
            return;
        }

        const filesToSync = Array.from(this.pendingFiles);
        this.pendingFiles.clear();

        console.log(`MobileCoder: Auto-syncing ${filesToSync.length} changed files`);

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const config = vscode.workspace.getConfiguration('mobilecoder');
        const syncDir = config.get<string>('syncDirectory') || workspaceFolder.uri.fsPath;
        const syncPath = path.isAbsolute(syncDir) ? syncDir : path.join(workspaceFolder.uri.fsPath, syncDir);

        let successCount = 0;
        let failCount = 0;

        for (const filePath of filesToSync) {
            try {
                const relativePath = path.relative(syncPath, filePath);
                const filename = path.basename(filePath);

                // Only sync files with allowed extensions
                if (this.shouldSyncFile(filename)) {
                    const success = await this.syncService.syncFile(filePath, filename, relativePath);
                    if (success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                }
            } catch (error) {
                console.error(`Failed to sync file ${filePath}:`, error);
                failCount++;
            }
        }

        if (successCount > 0 || failCount > 0) {
            const message = `Auto-synced: ${successCount} success, ${failCount} failed`;
            
            if (failCount === 0) {
                console.log(`MobileCoder: ${message}`);
            } else {
                console.warn(`MobileCoder: ${message}`);
                vscode.window.showWarningMessage(`MobileCoder: ${message}`);
            }
        }
    }

    private shouldSyncFile(filename: string): boolean {
        const ext = path.extname(filename).toLowerCase();
        const syncableExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.css', '.html', '.md', '.json', '.xml', '.txt'];
        return syncableExtensions.includes(ext) && !filename.startsWith('.');
    }

    dispose(): void {
        this.stop();
    }
}