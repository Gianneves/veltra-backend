export interface StravaAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
    profile?: string;
    profile_medium?: string;
  };
}

export interface StravaLap {
  name?: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  average_speed?: number;
  max_speed?: number;
}

export interface Activity {
  id?: number;
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
  has_heartrate?: boolean;
  start_date?: string;
  start_date_local?: string;
  timezone?: string;
  laps?: StravaLap[];
}

export interface StravaWebhookEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  event_time: number;
  owner_id: number;
  subscription_id?: number;
  updates?: Record<string, unknown>;
}
