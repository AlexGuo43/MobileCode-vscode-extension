import * as vscode from 'vscode';
import axios from 'axios';

export interface AuthUser {
    id: string;
    email: string;
    deviceName: string;
    access_token: string;
}

export class AuthService {
    private static readonly API_BASE_URL = 'https://backend-production-a87d.up.railway.app/api';
    private static readonly ACCESS_TOKEN_KEY = 'mobilecoder.jwt_access_token';
    private static readonly USER_DATA_KEY = 'mobilecoder.user_data';

    private authStateListeners: ((authenticated: boolean) => void)[] = [];

    constructor(private context: vscode.ExtensionContext) {}

    async signIn(): Promise<boolean> {
        try {
            // Get user credentials via input boxes
            const email = await vscode.window.showInputBox({
                prompt: 'Enter your email address',
                placeHolder: 'email@example.com',
                validateInput: (value) => {
                    if (!value || !value.includes('@')) {
                        return 'Please enter a valid email address';
                    }
                    return null;
                }
            });

            if (!email) {
                return false;
            }

            const password = await vscode.window.showInputBox({
                prompt: 'Enter your password',
                password: true
            });

            if (!password) {
                return false;
            }

            const deviceName = await vscode.window.showInputBox({
                prompt: 'Enter a name for this device',
                placeHolder: 'VS Code Extension',
                value: 'VS Code Extension'
            });

            if (!deviceName) {
                return false;
            }

            // Login with credentials
            const response = await axios.post(`${AuthService.API_BASE_URL}/auth/login`, {
                email,
                password,
                device_name: deviceName,
                device_type: "desktop",
                platform: "vscode"
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                const { token, user } = response.data.data;
                const userData: AuthUser = {
                    id: user.id,
                    email: user.email,
                    deviceName: deviceName,
                    access_token: token
                };

                // Store auth data
                await this.context.secrets.store(AuthService.ACCESS_TOKEN_KEY, token);
                await this.context.globalState.update(AuthService.USER_DATA_KEY, userData);

                this.notifyAuthStateChanged(true);
                return true;
            }

            vscode.window.showErrorMessage('Login failed: ' + (response.data.message || 'Unknown error'));
            return false;
        } catch (error: any) {
            console.error('Sign in error:', error);
            const message = error.response?.data?.message || error.message || 'Login failed';
            vscode.window.showErrorMessage('Login failed: ' + message);
            return false;
        }
    }

    async register(): Promise<boolean> {
        try {
            // Get user credentials via input boxes
            const email = await vscode.window.showInputBox({
                prompt: 'Enter your email address',
                placeHolder: 'email@example.com',
                validateInput: (value) => {
                    if (!value || !value.includes('@')) {
                        return 'Please enter a valid email address';
                    }
                    return null;
                }
            });

            if (!email) {
                return false;
            }

            const password = await vscode.window.showInputBox({
                prompt: 'Enter a password',
                password: true,
                validateInput: (value) => {
                    if (!value || value.length < 6) {
                        return 'Password must be at least 6 characters long';
                    }
                    return null;
                }
            });

            if (!password) {
                return false;
            }

            const deviceName = await vscode.window.showInputBox({
                prompt: 'Enter a name for this device',
                placeHolder: 'VS Code Extension',
                value: 'VS Code Extension'
            });

            if (!deviceName) {
                return false;
            }

            // Register new user
            const response = await axios.post(`${AuthService.API_BASE_URL}/auth/register`, {
                email,
                password,
                device_name: deviceName,
                device_type: "desktop",
                platform: "vscode"
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                const { token, user } = response.data.data;
                const userData: AuthUser = {
                    id: user.id,
                    email: user.email,
                    deviceName: deviceName,
                    access_token: token
                };

                // Store auth data
                await this.context.secrets.store(AuthService.ACCESS_TOKEN_KEY, token);
                await this.context.globalState.update(AuthService.USER_DATA_KEY, userData);

                this.notifyAuthStateChanged(true);
                vscode.window.showInformationMessage('Registration successful!');
                return true;
            }

            vscode.window.showErrorMessage('Registration failed: ' + (response.data.message || 'Unknown error'));
            return false;
        } catch (error: any) {
            console.error('Registration error:', error);
            const message = error.response?.data?.message || error.message || 'Registration failed';
            vscode.window.showErrorMessage('Registration failed: ' + message);
            return false;
        }
    }

    async signOut(): Promise<void> {
        try {
            await this.context.secrets.delete(AuthService.ACCESS_TOKEN_KEY);
            await this.context.globalState.update(AuthService.USER_DATA_KEY, undefined);
            this.notifyAuthStateChanged(false);
        } catch (error) {
            console.error('Sign out error:', error);
        }
    }

    async isAuthenticated(): Promise<boolean> {
        try {
            const accessToken = await this.context.secrets.get(AuthService.ACCESS_TOKEN_KEY);
            if (!accessToken) {
                return false;
            }

            // Verify token is still valid
            const response = await axios.get(`${AuthService.API_BASE_URL}/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            return response.data.success;
        } catch (error) {
            // Token is invalid, clear stored data
            await this.signOut();
            return false;
        }
    }

    async getCurrentUser(): Promise<AuthUser | null> {
        try {
            const isAuth = await this.isAuthenticated();
            if (!isAuth) {
                return null;
            }

            const userData = this.context.globalState.get<AuthUser>(AuthService.USER_DATA_KEY);
            return userData || null;
        } catch (error) {
            console.error('Get current user error:', error);
            return null;
        }
    }

    async getAccessToken(): Promise<string | null> {
        try {
            return await this.context.secrets.get(AuthService.ACCESS_TOKEN_KEY) || null;
        } catch (error) {
            console.error('Get access token error:', error);
            return null;
        }
    }

    async checkAuthState(): Promise<boolean> {
        const authenticated = await this.isAuthenticated();
        this.notifyAuthStateChanged(authenticated);
        return authenticated;
    }

    onAuthStateChanged(listener: (authenticated: boolean) => void): vscode.Disposable {
        this.authStateListeners.push(listener);
        return new vscode.Disposable(() => {
            const index = this.authStateListeners.indexOf(listener);
            if (index !== -1) {
                this.authStateListeners.splice(index, 1);
            }
        });
    }

    private notifyAuthStateChanged(authenticated: boolean): void {
        this.authStateListeners.forEach(listener => listener(authenticated));
    }
}