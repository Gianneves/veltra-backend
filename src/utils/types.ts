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

export interface Activity {
    activityStravaId: number;
    elapsed_time: number;
    moving_time: number;
    name: string;
    type: string;
    sport_type: string;
    distance: number;
    max_speed: number;
    total_elevation_gain: number;
    average_cadence: number;
    average_speed: number;
    average_heartrate: number;
    max_heartrate: number;
    max_watts: number;
}