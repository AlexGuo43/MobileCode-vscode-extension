import * as vscode from 'vscode';
import { AuthService } from '../services/authService';

interface AuthItem {
    label: string;
    command?: string;
    icon?: vscode.ThemeIcon;
}

export class AuthProvider implements vscode.TreeDataProvider<AuthItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AuthItem | undefined | null | void> = new vscode.EventEmitter<AuthItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AuthItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private authService: AuthService) {
        // Listen for auth state changes
        this.authService.onAuthStateChanged(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AuthItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        
        if (element.command) {
            item.command = {
                command: element.command,
                title: element.label
            };
        }
        
        if (element.icon) {
            item.iconPath = element.icon;
        }

        return item;
    }

    async getChildren(element?: AuthItem): Promise<AuthItem[]> {
        if (element) {
            return [];
        }

        const isAuthenticated = await this.authService.isAuthenticated();
        
        if (isAuthenticated) {
            const user = await this.authService.getCurrentUser();
            return [
                {
                    label: `Signed in as ${user?.email || 'Unknown'}`,
                    icon: new vscode.ThemeIcon('account')
                },
                {
                    label: 'Sign Out',
                    command: 'mobilecoder.signOut',
                    icon: new vscode.ThemeIcon('sign-out')
                }
            ];
        } else {
            return [
                {
                    label: 'Sign in to MobileCode to sync files',
                    icon: new vscode.ThemeIcon('info')
                },
                {
                    label: 'Sign In',
                    command: 'mobilecoder.signIn',
                    icon: new vscode.ThemeIcon('sign-in')
                }
            ];
        }
    }
}