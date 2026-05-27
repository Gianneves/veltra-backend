export interface StravaAuthResponse {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete: {
        id: number;
        firstname: string;
        lastname: string;
    }
}