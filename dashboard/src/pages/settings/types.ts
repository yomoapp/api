export interface Timed { enabled?: boolean; time?: string }
export interface FullSettings {
  currency?: string; timezone?: string; wirdDailyPages?: number; calcMethod?: string;
  location?: { label: string; lat: number; lng: number; source: 'city' | 'gps' } | null;
  reminders?: {
    prayers?: Record<string, { enabled?: boolean; offsetMin?: number }>;
    expenses?: Timed; wird?: Timed; cash?: Timed; proteinLunch?: Timed; proteinNight?: Timed;
  };
  privacy?: { hideOnLaunch?: boolean; biometricLock?: boolean };
  health?: { proteinPerKg?: number; proteinTargetG?: number | null; goalWeightKg?: number | null };
  sleep?: { targetHours?: number; wakeFor?: string; wakeBeforeFajrMin?: number; fallAsleepMin?: number; timerMin?: number };
  dayClose?: { enabled?: boolean; mode?: string; time?: string };
  sms?: { enabled?: boolean; senders?: { id: string; name: string; enabled: boolean }[] };
  work?: {
    weeklyGoalHours?: number; autoDnd?: boolean; keepScreenOn?: boolean; breakReminderMin?: number; dailyGoalSessions?: number;
    startReminder?: { enabled?: boolean; time?: string; days?: number[] };
    distractingApps?: { package: string; label: string }[];
  };
  listen?: {
    dailySongLimitMins?: number | null; greenAfterFajrUntil?: string | null; greenAfterAdhanMins?: number; greenBeforeBedMins?: number;
    greenAlert?: boolean; whyPrompt?: boolean; whyAfterMins?: number; fridayStory?: boolean; watchAll?: boolean;
    watchApps?: { pkg: string; label: string }[]; appLimits?: { pkg: string; label: string; mins: number }[];
  };
}
export interface FullMe { id: string; name: string; email: string; settings: FullSettings }
