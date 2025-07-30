import * as vscode from 'vscode';
import { AuthService } from './services/authService';
import { SyncService } from './services/syncService';
import { FileWatcher } from './services/fileWatcher';
import { RemoteFilesProvider } from './providers/remoteFilesProvider';
import { AuthProvider } from './providers/authProvider';
import { RemoteFileSystemProvider } from './providers/remoteFileSystemProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('MobileCoder extension is now active!');

    const authService = new AuthService(context);
    const syncService = new SyncService(authService);
    const fileWatcher = new FileWatcher(syncService);
    
    const remoteFilesProvider = new RemoteFilesProvider(syncService);
    const authProvider = new AuthProvider(authService);
    
    // Register file system provider
    const fileSystemProvider = new RemoteFileSystemProvider(syncService);
    const fileSystemRegistration = vscode.workspace.registerFileSystemProvider('mobilecoder-remote', fileSystemProvider);

    // Register tree data providers
    vscode.window.createTreeView('mobilecoderFiles', {
        treeDataProvider: remoteFilesProvider,
        showCollapseAll: true
    });
    
    vscode.window.createTreeView('mobilecoderAuth', {
        treeDataProvider: authProvider
    });

    // Update context based on auth state
    authService.onAuthStateChanged((authenticated: boolean) => {
        vscode.commands.executeCommand('setContext', 'mobilecoder.authenticated', authenticated);
        if (authenticated) {
            remoteFilesProvider.refresh();
            fileSystemProvider.refreshCache();
            fileWatcher.start();
        } else {
            fileWatcher.stop();
        }
    });

    // Register commands
    const signInCommand = vscode.commands.registerCommand('mobilecoder.signIn', async () => {
        try {
            const success = await authService.signIn();
            if (success) {
                vscode.window.showInformationMessage('Successfully signed in to MobileCoder!');
            } else {
                vscode.window.showErrorMessage('Failed to sign in. Please try again.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Sign in error: ${error}`);
        }
    });

    const signOutCommand = vscode.commands.registerCommand('mobilecoder.signOut', async () => {
        try {
            await authService.signOut();
            vscode.window.showInformationMessage('Signed out from MobileCoder.');
        } catch (error) {
            vscode.window.showErrorMessage(`Sign out error: ${error}`);
        }
    });

    const syncCommand = vscode.commands.registerCommand('mobilecoder.sync', async () => {
        try {
            const isAuthenticated = await authService.isAuthenticated();
            if (!isAuthenticated) {
                vscode.window.showWarningMessage('Please sign in first to sync files.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing files with MobileCoder...',
                cancellable: false
            }, async (progress) => {
                const results = await syncService.syncAllFiles();
                const total = results.success + results.failed;
                
                if (results.failed === 0) {
                    vscode.window.showInformationMessage(
                        `Successfully synced ${results.success} file${results.success === 1 ? '' : 's'}.`
                    );
                } else {
                    vscode.window.showWarningMessage(
                        `Synced ${results.success}/${total} files. ${results.failed} file${results.failed === 1 ? '' : 's'} failed.`
                    );
                }
                
                remoteFilesProvider.refresh();
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Sync error: ${error}`);
        }
    });

    const openFileInViewerCommand = vscode.commands.registerCommand('mobilecoder.openFileInViewer', async (item: any) => {
        try {
            const isAuthenticated = await authService.isAuthenticated();
            if (!isAuthenticated) {
                vscode.window.showWarningMessage('Please sign in first to view files.');
                return;
            }

            // Refresh the file system cache to ensure we have the latest content
            await fileSystemProvider.refreshCache();

            // Create a virtual URI for the remote file
            const uri = vscode.Uri.parse(`mobilecoder-remote://${item.id}/${item.filename}`);
            
            // Open the file with VS Code's native text editor
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
    });

    // Keep the download command for context menu
    const downloadFileCommand = vscode.commands.registerCommand('mobilecoder.downloadFile', async (item: any) => {
        try {
            const isAuthenticated = await authService.isAuthenticated();
            if (!isAuthenticated) {
                vscode.window.showWarningMessage('Please sign in first to download files.');
                return;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }

            const localPath = vscode.Uri.joinPath(workspaceFolder.uri, item.filename);
            const success = await syncService.downloadFile(item.id, localPath.fsPath);
            
            if (success) {
                vscode.window.showInformationMessage(`Downloaded ${item.filename}`);
                // Open the downloaded file
                const document = await vscode.workspace.openTextDocument(localPath);
                await vscode.window.showTextDocument(document);
            } else {
                vscode.window.showErrorMessage(`Failed to download ${item.filename}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Download error: ${error}`);
        }
    });

    // Check initial auth state
    authService.checkAuthState().then(authenticated => {
        vscode.commands.executeCommand('setContext', 'mobilecoder.authenticated', authenticated);
        if (authenticated) {
            remoteFilesProvider.refresh();
            fileSystemProvider.refreshCache();
            fileWatcher.start();
        }
    });

    // Register disposables
    context.subscriptions.push(
        signInCommand,
        signOutCommand,
        syncCommand,
        openFileInViewerCommand,
        downloadFileCommand,
        fileSystemRegistration,
        fileWatcher
    );
}

export function deactivate() {
    console.log('MobileCoder extension is being deactivated.');
}