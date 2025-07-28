import * as vscode from 'vscode';
import { SyncService, SyncFile } from '../services/syncService';

export class RemoteFilesProvider implements vscode.TreeDataProvider<SyncFile> {
    private _onDidChangeTreeData: vscode.EventEmitter<SyncFile | undefined | null | void> = new vscode.EventEmitter<SyncFile | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SyncFile | undefined | null | void> = this._onDidChangeTreeData.event;

    private files: SyncFile[] = [];

    constructor(private syncService: SyncService) {
        this.loadFiles();
    }

    refresh(): void {
        this.loadFiles();
    }

    private async loadFiles(): Promise<void> {
        try {
            this.files = await this.syncService.getRemoteFiles();
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.error('Failed to load remote files:', error);
            this.files = [];
            this._onDidChangeTreeData.fire();
        }
    }

    getTreeItem(element: SyncFile): vscode.TreeItem {
        const item = new vscode.TreeItem(element.filename, vscode.TreeItemCollapsibleState.None);
        
        item.id = element.id;
        const date = new Date(element.updated_at);
        const isValidDate = !isNaN(date.getTime());
        
        const formatDate = (date: Date) => {
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
            });
        };
        
        item.tooltip = `${element.filename}\nLast updated: ${isValidDate ? date.toLocaleString() : 'Unknown'}`;
        item.description = isValidDate ? formatDate(date) : 'Invalid date';
        
        // Set icon based on file extension
        item.iconPath = this.getFileIcon(element.filename);
        
        // Add context menu
        item.contextValue = 'mobilecoderFile';
        
        // Add command to download file
        item.command = {
            command: 'mobilecoder.downloadFile',
            title: 'Download File',
            arguments: [element]
        };

        return item;
    }

    getChildren(element?: SyncFile): Thenable<SyncFile[]> {
        if (!element) {
            // Return root items (all remote files)
            return Promise.resolve(this.files);
        }
        
        // Files don't have children
        return Promise.resolve([]);
    }

    private getFileIcon(filename: string): vscode.ThemeIcon {
        const ext = filename.split('.').pop()?.toLowerCase();
        
        const iconMap: { [key: string]: string } = {
            'js': 'javascript',
            'ts': 'typescript',
            'jsx': 'react',
            'tsx': 'react',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'h': 'h',
            'css': 'css',
            'html': 'html',
            'md': 'markdown',
            'json': 'json',
            'xml': 'xml',
            'txt': 'text'
        };

        const iconName = iconMap[ext || ''] || 'file';
        return new vscode.ThemeIcon(iconName);
    }
}