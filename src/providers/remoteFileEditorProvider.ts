import * as vscode from 'vscode';
import { SyncService, SyncFile } from '../services/syncService';

export class RemoteFileEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext, syncService: SyncService): vscode.Disposable {
        const provider = new RemoteFileEditorProvider(context, syncService);
        
        // Register virtual document provider
        const documentProvider = vscode.workspace.registerTextDocumentContentProvider('mobilecoder-remote', {
            provideTextDocumentContent: async (uri: vscode.Uri): Promise<string> => {
                const fileId = uri.authority;
                try {
                    const files = await syncService.getRemoteFiles();
                    const file = files.find(f => f.id === fileId);
                    return file ? file.content : '';
                } catch (error) {
                    console.error('Failed to load document content:', error);
                    return '';
                }
            }
        });
        
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            'mobilecoder.remoteFileEditor',
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: false,
            }
        );
        
        return vscode.Disposable.from(documentProvider, providerRegistration);
    }

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly syncService: SyncService
    ) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup initial webview content
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(
            async (message) => {
                console.log('Received message from webview:', message.type);
                switch (message.type) {
                    case 'ready':
                        console.log('Webview ready, sending file content');
                        // Send initial file content
                        await this.sendFileContent(webviewPanel, document);
                        break;
                    case 'save':
                        console.log('Saving file content:', message.content?.length || 0, 'characters');
                        // Save content back to remote
                        await this.saveToRemote(document.uri, message.content);
                        vscode.window.showInformationMessage('File saved to MobileCoder');
                        break;
                }
            }
        );

        // Update webview when document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.sendFileContent(webviewPanel, document);
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private async sendFileContent(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument) {
        const fileId = this.getFileIdFromUri(document.uri);
        console.log('Sending file content for fileId:', fileId);
        if (!fileId) {
            console.log('No file ID found from URI:', document.uri.toString());
            return;
        }

        try {
            const files = await this.syncService.getRemoteFiles();
            console.log('Got remote files:', files.length);
            const file = files.find(f => f.id === fileId);
            
            if (file) {
                console.log('Found file, sending content:', file.filename, file.content?.length || 0, 'characters');
                webviewPanel.webview.postMessage({
                    type: 'fileContent',
                    content: file.content,
                    filename: file.filename,
                    language: file.language,
                    lastModified: file.updated_at
                });
            } else {
                console.log('File not found with ID:', fileId);
            }
        } catch (error) {
            console.error('Failed to load file content:', error);
            vscode.window.showErrorMessage('Failed to load file content');
        }
    }

    private async saveToRemote(uri: vscode.Uri, content: string) {
        const fileId = this.getFileIdFromUri(uri);
        if (!fileId) return;

        try {
            const success = await this.syncService.updateRemoteFileContent(fileId, content);
            if (!success) {
                vscode.window.showErrorMessage('Failed to save file to MobileCoder');
            }
        } catch (error) {
            console.error('Failed to save file:', error);
            vscode.window.showErrorMessage('Failed to save file');
        }
    }

    private getFileIdFromUri(uri: vscode.Uri): string | null {
        // Extract file ID from URI scheme: mobilecoder-remote://fileId
        if (uri.scheme === 'mobilecoder-remote') {
            return uri.authority;
        }
        return null;
    }

    private getHtmlForWebview(webview: vscode.Webview, document: vscode.TextDocument): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'out', 'webview', 'editor.js'
        ));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'out', 'webview', 'editor.css'
        ));

        const nonce = this.getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <title>MobileCoder File Viewer</title>
        </head>
        <body>
            <div class="header">
                <h2 id="filename">Loading...</h2>
                <div class="actions">
                    <button id="saveBtn" disabled>Save to MobileCoder</button>
                    <span id="lastModified"></span>
                </div>
            </div>
            <div class="editor-container">
                <textarea id="editor" placeholder="Loading file content..."></textarea>
            </div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}