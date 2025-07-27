import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { AuthService } from './authService';

export interface SyncFile {
    id: string;
    filename: string;
    content: string;
    language: string;
    description: string;
    updated_at: string;
    public: boolean;
}

export interface SyncResults {
    success: number;
    failed: number;
}

export class SyncService {
    private static readonly GIST_API_URL = 'https://api.github.com/gists';
    private static readonly SYNC_METADATA_FILE = '.mobilecoder-sync.json';

    constructor(private authService: AuthService) {}

    async syncAllFiles(): Promise<SyncResults> {
        const results: SyncResults = { success: 0, failed: 0 };

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder open');
            }

            const config = vscode.workspace.getConfiguration('mobilecoder');
            const syncDir = config.get<string>('syncDirectory') || workspaceFolder.uri.fsPath;
            const syncPath = path.isAbsolute(syncDir) ? syncDir : path.join(workspaceFolder.uri.fsPath, syncDir);

            // Get all files in sync directory
            const files = await this.getFilesToSync(syncPath);

            for (const filePath of files) {
                try {
                    const relativePath = path.relative(syncPath, filePath);
                    const filename = path.basename(filePath);
                    
                    const success = await this.syncFile(filePath, filename, relativePath);
                    if (success) {
                        results.success++;
                    } else {
                        results.failed++;
                    }
                } catch (error) {
                    console.error(`Failed to sync file ${filePath}:`, error);
                    results.failed++;
                }
            }
        } catch (error) {
            console.error('Sync all files error:', error);
            throw error;
        }

        return results;
    }

    async syncFile(localFilePath: string, filename: string, relativePath: string): Promise<boolean> {
        try {
            const accessToken = await this.authService.getAccessToken();
            if (!accessToken) {
                throw new Error('Not authenticated');
            }

            const metadata = await this.getSyncMetadata();
            const gistId = metadata.files[relativePath];

            if (gistId) {
                // File exists remotely, check which is newer
                const localStat = fs.statSync(localFilePath);
                const remoteStat = await this.getRemoteFileStats(gistId, accessToken);

                if (remoteStat && localStat.mtime) {
                    const localTime = localStat.mtime.getTime();
                    const remoteTime = new Date(remoteStat.updated_at).getTime();

                    if (remoteTime > localTime) {
                        // Remote is newer, download
                        return await this.downloadFile(gistId, localFilePath);
                    } else {
                        // Local is newer, upload
                        return await this.updateRemoteFile(gistId, localFilePath, filename, accessToken) !== null;
                    }
                }
            } else {
                // File doesn't exist remotely, upload it
                const uploadedId = await this.uploadFile(localFilePath, filename, relativePath, accessToken);
                return uploadedId !== null;
            }

            return true;
        } catch (error) {
            console.error('Sync file error:', error);
            return false;
        }
    }

    async uploadFile(localFilePath: string, filename: string, relativePath: string, accessToken: string): Promise<string | null> {
        try {
            const content = fs.readFileSync(localFilePath, 'utf8');
            const language = this.getLanguageFromFilename(filename);

            const gistData = {
                description: `MobileCoder file: ${filename}`,
                public: false,
                files: {
                    [filename]: {
                        content: content
                    }
                }
            };

            const response = await axios.post(SyncService.GIST_API_URL, gistData, {
                headers: {
                    'Authorization': `token ${accessToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 201) {
                const gist = response.data;
                await this.updateSyncMetadata(relativePath, gist.id);
                return gist.id;
            }

            return null;
        } catch (error) {
            console.error('Upload file error:', error);
            return null;
        }
    }

    async downloadFile(gistId: string, localFilePath: string): Promise<boolean> {
        try {
            const accessToken = await this.authService.getAccessToken();
            if (!accessToken) {
                throw new Error('Not authenticated');
            }

            const response = await axios.get(`${SyncService.GIST_API_URL}/${gistId}`, {
                headers: {
                    'Authorization': `token ${accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.status === 200) {
                const gist = response.data;
                const files = Object.values(gist.files) as any[];
                
                if (files.length === 0) {
                    throw new Error('No files in gist');
                }

                const file = files[0];
                
                // Ensure directory exists
                const dir = path.dirname(localFilePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(localFilePath, file.content, 'utf8');
                return true;
            }

            return false;
        } catch (error) {
            console.error('Download file error:', error);
            return false;
        }
    }

    async getRemoteFiles(): Promise<SyncFile[]> {
        try {
            const accessToken = await this.authService.getAccessToken();
            if (!accessToken) {
                return [];
            }

            const response = await axios.get(SyncService.GIST_API_URL, {
                headers: {
                    'Authorization': `token ${accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.status === 200) {
                const gists = response.data;
                
                return gists
                    .filter((gist: any) => gist.description?.startsWith('MobileCoder file:'))
                    .map((gist: any) => {
                        const files = Object.values(gist.files) as any[];
                        const file = files[0];
                        
                        return {
                            id: gist.id,
                            filename: file.filename,
                            content: file.content || '',
                            language: file.language || 'text',
                            description: gist.description,
                            updated_at: gist.updated_at,
                            public: gist.public
                        };
                    });
            }

            return [];
        } catch (error) {
            console.error('Get remote files error:', error);
            return [];
        }
    }

    private async updateRemoteFile(gistId: string, localFilePath: string, filename: string, accessToken: string): Promise<string | null> {
        try {
            const content = fs.readFileSync(localFilePath, 'utf8');

            const updateData = {
                files: {
                    [filename]: {
                        content: content
                    }
                }
            };

            const response = await axios.patch(`${SyncService.GIST_API_URL}/${gistId}`, updateData, {
                headers: {
                    'Authorization': `token ${accessToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 200) {
                return gistId;
            }

            return null;
        } catch (error) {
            console.error('Update remote file error:', error);
            return null;
        }
    }

    private async getRemoteFileStats(gistId: string, accessToken: string): Promise<{ updated_at: string } | null> {
        try {
            const response = await axios.get(`${SyncService.GIST_API_URL}/${gistId}`, {
                headers: {
                    'Authorization': `token ${accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.status === 200) {
                const gist = response.data;
                return { updated_at: gist.updated_at };
            }

            return null;
        } catch (error) {
            console.error('Get remote file stats error:', error);
            return null;
        }
    }

    private async getFilesToSync(syncPath: string): Promise<string[]> {
        const files: string[] = [];
        
        const traverse = (dir: string) => {
            const items = fs.readdirSync(dir);
            
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    // Skip hidden directories and node_modules
                    if (!item.startsWith('.') && item !== 'node_modules') {
                        traverse(fullPath);
                    }
                } else if (stat.isFile()) {
                    // Skip hidden files and certain extensions
                    if (!item.startsWith('.') && this.shouldSyncFile(item)) {
                        files.push(fullPath);
                    }
                }
            }
        };

        if (fs.existsSync(syncPath)) {
            traverse(syncPath);
        }

        return files;
    }

    private shouldSyncFile(filename: string): boolean {
        const ext = path.extname(filename).toLowerCase();
        const syncableExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.css', '.html', '.md', '.json', '.xml', '.txt'];
        return syncableExtensions.includes(ext);
    }

    private async getSyncMetadata(): Promise<{ lastSync: string; files: { [key: string]: string } }> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return { lastSync: new Date().toISOString(), files: {} };
            }

            const metadataPath = path.join(workspaceFolder.uri.fsPath, SyncService.SYNC_METADATA_FILE);
            
            if (fs.existsSync(metadataPath)) {
                const data = fs.readFileSync(metadataPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Get sync metadata error:', error);
        }

        return { lastSync: new Date().toISOString(), files: {} };
    }

    private async updateSyncMetadata(relativePath: string, gistId: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const metadata = await this.getSyncMetadata();
            metadata.files[relativePath] = gistId;
            metadata.lastSync = new Date().toISOString();

            const metadataPath = path.join(workspaceFolder.uri.fsPath, SyncService.SYNC_METADATA_FILE);
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
        } catch (error) {
            console.error('Update sync metadata error:', error);
        }
    }

    private getLanguageFromFilename(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const langMap: { [key: string]: string } = {
            '.py': 'python',
            '.js': 'javascript',
            '.ts': 'typescript',
            '.jsx': 'javascript',
            '.tsx': 'typescript',
            '.json': 'json',
            '.md': 'markdown',
            '.css': 'css',
            '.html': 'html',
            '.txt': 'text',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.h': 'c'
        };
        return langMap[ext] || 'text';
    }
}