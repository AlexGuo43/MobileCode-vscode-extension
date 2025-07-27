import * as vscode from 'vscode';
import axios from 'axios';

export interface AuthUser {
    id: string;
    login: string;
    name: string;
    email: string;
    avatar_url: string;
    access_token: string;
}

export class AuthService {
    private static readonly ACCESS_TOKEN_KEY = 'mobilecoder.github_access_token';
    private static readonly USER_DATA_KEY = 'mobilecoder.github_user_data';

    private authStateListeners: ((authenticated: boolean) => void)[] = [];

    constructor(private context: vscode.ExtensionContext) {}

    async signIn(): Promise<boolean> {
        try {
            // Use GitHub's device flow for OAuth
            const deviceResponse = await axios.post('https://github.com/login/device/code', {
                client_id: process.env.GITHUB_CLIENT_ID || 'your-github-client-id', // You'll need to replace this
                scope: 'user:email gist'
            }, {
                headers: {
                    'Accept': 'application/json'
                }
            });

            const { device_code, user_code, verification_uri, expires_in, interval } = deviceResponse.data;

            // Show user code and open verification URL
            const action = await vscode.window.showInformationMessage(
                `To sign in to GitHub, use a web browser to open the page ${verification_uri} and enter the code ${user_code}`,
                'Open GitHub',
                'I\'ve entered the code'
            );

            if (action === 'Open GitHub') {
                vscode.env.openExternal(vscode.Uri.parse(verification_uri));
            }

            // Poll for access token
            return await this.pollForAccessToken(device_code, interval, expires_in);
        } catch (error) {
            console.error('Sign in error:', error);
            return false;
        }
    }

    private async pollForAccessToken(deviceCode: string, interval: number, expiresIn: number): Promise<boolean> {
        const startTime = Date.now();
        const maxTime = expiresIn * 1000;

        while (Date.now() - startTime < maxTime) {
            try {
                const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
                    client_id: process.env.GITHUB_CLIENT_ID || 'your-github-client-id',
                    device_code: deviceCode,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                }, {
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                const { access_token, error } = tokenResponse.data;

                if (access_token) {
                    // Get user data
                    const userResponse = await axios.get('https://api.github.com/user', {
                        headers: {
                            'Authorization': `token ${access_token}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    const userData = userResponse.data;
                    const user: AuthUser = {
                        id: userData.id.toString(),
                        login: userData.login,
                        name: userData.name || userData.login,
                        email: userData.email,
                        avatar_url: userData.avatar_url,
                        access_token: access_token
                    };

                    // Store auth data
                    await this.context.secrets.store(AuthService.ACCESS_TOKEN_KEY, access_token);
                    await this.context.globalState.update(AuthService.USER_DATA_KEY, user);

                    this.notifyAuthStateChanged(true);
                    return true;
                } else if (error === 'authorization_pending') {
                    // Continue polling
                    await new Promise(resolve => setTimeout(resolve, interval * 1000));
                } else if (error === 'slow_down') {
                    // Increase interval
                    interval += 5;
                    await new Promise(resolve => setTimeout(resolve, interval * 1000));
                } else {
                    // Other errors (expired_token, unsupported_grant_type, etc.)
                    break;
                }
            } catch (error) {
                console.error('Token polling error:', error);
                break;
            }
        }

        return false;
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
            const response = await axios.get('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            return response.status === 200;
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