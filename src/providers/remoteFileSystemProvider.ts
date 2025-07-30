import * as vscode from 'vscode';
import { SyncService, SyncFile } from '../services/syncService';

export class RemoteFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    private fileCache = new Map<string, SyncFile>();

    constructor(private syncService: SyncService) {}

    // Refresh the file cache
    async refreshCache(): Promise<void> {
        try {
            const files = await this.syncService.getRemoteFiles();
            this.fileCache.clear();
            files.forEach(file => {
                this.fileCache.set(file.id, file);
            });
        } catch (error) {
            console.error('Failed to refresh file cache:', error);
        }
    }

    watch(uri: vscode.Uri): vscode.Disposable {
        // For now, we don't implement real-time watching
        return new vscode.Disposable(() => {});
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const fileId = this.getFileIdFromUri(uri);
        const file = this.fileCache.get(fileId);
        
        if (!file) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return {
            type: vscode.FileType.File,
            ctime: new Date(file.updated_at).getTime(),
            mtime: new Date(file.updated_at).getTime(),
            size: file.content.length
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        // We don't support directories in this implementation
        return [];
    }

    createDirectory(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Creating directories is not supported');
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const fileId = this.getFileIdFromUri(uri);
        const file = this.fileCache.get(fileId);
        
        if (!file) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        return Buffer.from(file.content, 'utf8');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
        const fileId = this.getFileIdFromUri(uri);
        const contentString = Buffer.from(content).toString('utf8');
        
        console.log('Writing file:', {
            uri: uri.toString(),
            fileId,
            contentLength: contentString.length,
            options
        });
        
        try {
            const success = await this.syncService.updateRemoteFileContent(fileId, contentString);
            console.log('Update result:', success);
            
            if (!success) {
                console.error('SyncService returned false for updateRemoteFileContent');
                throw vscode.FileSystemError.Unavailable('Failed to save file to MobileCoder');
            }

            // Update our cache
            const file = this.fileCache.get(fileId);
            if (file) {
                file.content = contentString;
                file.updated_at = new Date().toISOString();
                console.log('Updated cache for file:', fileId);
            } else {
                console.warn('File not found in cache:', fileId);
            }

            // Notify VS Code of the change
            this._emitter.fire([{
                type: vscode.FileChangeType.Changed,
                uri: uri
            }]);

            vscode.window.showInformationMessage(`Saved ${this.getFilenameFromUri(uri)} to MobileCoder`);
        } catch (error) {
            console.error('Failed to write file:', error);
            console.error('Error details:', error);
            throw vscode.FileSystemError.Unavailable(`Failed to save file to MobileCoder: ${error}`);
        }
    }

    delete(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Deleting files is not supported');
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('Renaming files is not supported');
    }

    private getFileIdFromUri(uri: vscode.Uri): string {
        // Extract file ID from URI: mobilecoder-remote://fileId/filename
        return uri.authority;
    }

    private getFilenameFromUri(uri: vscode.Uri): string {
        // Extract filename from URI path
        return uri.path.substring(1); // Remove leading slash
    }
}