import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
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
    private static readonly API_BASE_URL = 'https://backend-production-a87d.up.railway.app/api';
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
                const remoteStat = await this.getRemoteFileStats(relativePath, accessToken);

                if (remoteStat && localStat.mtime) {
                    const localTime = localStat.mtime.getTime();
                    const remoteTime = new Date(remoteStat.updated_at).getTime();

                    if (remoteTime > localTime) {
                        // Remote is newer, download
                        return await this.downloadFile(relativePath, localFilePath);
                    } else {
                        // Local is newer, upload
                        return await this.updateRemoteFile(relativePath, localFilePath, filename, accessToken) !== null;
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
            const stat = fs.statSync(localFilePath);
            
            const fileData = {
                filename: relativePath,
                content: content,
                checksum: this.calculateChecksum(content),
                lastModified: stat.mtime.toISOString()
            };

            const response = await axios.post(`${SyncService.API_BASE_URL}/sync/files`, fileData, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                await this.updateSyncMetadata(relativePath, relativePath);
                return relativePath;
            }

            return null;
        } catch (error) {
            console.error('Upload file error:', error);
            return null;
        }
    }

    async downloadFile(filename: string, localFilePath: string): Promise<boolean> {
        try {
            const accessToken = await this.authService.getAccessToken();
            if (!accessToken) {
                throw new Error('Not authenticated');
            }

            const response = await axios.get(`${SyncService.API_BASE_URL}/sync/files/${encodeURIComponent(filename)}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (response.data.success) {
                const fileData = response.data.data;
                
                // Ensure directory exists
                const dir = path.dirname(localFilePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(localFilePath, fileData.content, 'utf8');
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

            const response = await axios.get(`${SyncService.API_BASE_URL}/sync/files`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (response.data.success) {
                const files = response.data.data;
                
                return files.map((file: any) => ({
                    id: file.filename,
                    filename: file.filename,
                    content: file.content || '',
                    language: this.getLanguageFromFilename(file.filename),
                    description: `MobileCoder file: ${file.filename}`,
                    updated_at: file.last_modified,
                    public: false
                }));
            }

            return [];
        } catch (error) {
            console.error('Get remote files error:', error);
            return [];
        }
    }

    private async updateRemoteFile(filename: string, localFilePath: string, displayName: string, accessToken: string): Promise<string | null> {
        try {
            const content = fs.readFileSync(localFilePath, 'utf8');
            const stat = fs.statSync(localFilePath);

            const updateData = {
                filename: filename,
                content: content,
                checksum: this.calculateChecksum(content),
                lastModified: stat.mtime.toISOString()
            };

            const response = await axios.post(`${SyncService.API_BASE_URL}/sync/files`, updateData, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                return filename;
            }

            return null;
        } catch (error) {
            console.error('Update remote file error:', error);
            return null;
        }
    }

    private async getRemoteFileStats(filename: string, accessToken: string): Promise<{ updated_at: string } | null> {
        try {
            const response = await axios.get(`${SyncService.API_BASE_URL}/sync/files/${encodeURIComponent(filename)}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (response.data.success) {
                const fileData = response.data.data;
                return { updated_at: fileData.last_modified };
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

    private calculateChecksum(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    private getFileTypeFromFilename(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const typeMap: { [key: string]: string } = {
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
        return typeMap[ext] || 'text';
    }

    async updateRemoteFileContent(filename: string, content: string): Promise<boolean> {
        try {
            console.log('updateRemoteFileContent called with:', {
                filename,
                contentLength: content.length
            });
            
            const accessToken = await this.authService.getAccessToken();
            if (!accessToken) {
                console.error('No access token available');
                throw new Error('Not authenticated');
            }

            const updateData = {
                filename: filename,
                content: content,
                checksum: this.calculateChecksum(content),
                last_modified: new Date().toISOString(),
                file_type: this.getFileTypeFromFilename(filename)
            };

            console.log('Sending update request to API:', {
                url: `${SyncService.API_BASE_URL}/sync/files`,
                filename: updateData.filename,
                contentLength: updateData.content.length,
                checksum: updateData.checksum
            });

            const response = await axios.post(`${SyncService.API_BASE_URL}/sync/files`, updateData, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('API response:', {
                status: response.status,
                success: response.data?.success,
                data: response.data
            });

            return response.data.success;
        } catch (error) {
            console.error('Update remote file content error:', error);
            if (axios.isAxiosError(error)) {
                console.error('Axios error details:', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    message: error.message,
                    config: {
                        url: error.config?.url,
                        method: error.config?.method,
                        data: error.config?.data
                    }
                });
                // Log the full response if available
                if (error.response?.data) {
                    console.error('API error response:', JSON.stringify(error.response.data, null, 2));
                }
            }
            return false;
        }
    }
}