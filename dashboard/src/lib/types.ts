// Shapes of the real API responses (see src/modules/*/service.js).
export interface Me {
  id: string; name: string; email: string;
  settings: {
    currency: string; timezone: string; wirdDailyPages: number;
    health?: { proteinPerKg: number; proteinTargetG: number | null; goalWeightKg: number | null };
    sleep?: { targetHours: number };
    work?: { weeklyGoalHours: number };
  };
}
export interface Breakdown { categoryId: string; name: string | null; icon: string | null; color: string | null; total: number; count: number; percent: number }
export interface MoneySummary {
  month: string; income: number; expense: number; net: number; balance: number;
  breakdown: { income: Breakdown[]; expense: Breakdown[] };
  debts: { owedToMe: number; iOwe: number; openLent: number; openBorrowed: number };
}
export interface Tx {
  id: string; type: 'income' | 'expense'; amount: number; categoryId: string; date: string; note: string; source: 'app' | 'sms';
  debtId?: string; category: { id: string; name: string; icon: string; color: string } | null;
}
export interface TxPage { items: Tx[]; page: number; limit: number; total: number; totalPages: number; dayTotals: { date: string; income: number; expense: number; net: number }[] }
export interface Category { id: string; name: string; type: 'income' | 'expense'; icon: string; color: string; archived: boolean; system: boolean; group?: 'car' }
export interface Debt { id: string; direction: 'lent' | 'borrowed'; person: string; amount: number; remaining: number; date?: string; dueDate: string | null; note: string; status: 'open' | 'settled' }
export interface WeightList { items: { date: string; kg: number; avg7: number | null }[]; latestAvg7: number | null; changeWeek: number | null; goalWeightKg: number | null }
export interface ProteinSummary { days: { date: string; totalG: number; targetG: number }[]; avgG: number }
export interface GymAttendance { month: string; days: string[]; count: number; streakWeeks: number }
export interface GymSessionSummary { id: string; date: string; name: string; endedAt: string | null; volumeKg: number; exerciseCount: number; prCount: number }
export type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export type PrayerStatus = 'on_time' | 'late' | 'qada' | 'missed' | null;
export interface ReligionDay { date: string; exists: boolean; prayers: Record<PrayerKey, { status: PrayerStatus; place: string | null }>; witr: boolean; adhkar: { morning: boolean; evening: boolean } }
export interface ReligionRange { from: string; to: string; days: ReligionDay[] }
export interface ReligionStats {
  period: string; from: string; to: string; days: number; daysLogged: number; prayersRecorded: number;
  byStatus: Record<'on_time' | 'late' | 'qada' | 'missed', number>;
  onTimePercent: number | null; mosquePercent: number | null; jamaahPercent: number | null; congregationPercent: number | null; sunnahPercent: number | null;
  witrDays: number; adhkarMorningDays: number; adhkarEveningDays: number;
}
export interface WirdProgress {
  khatmaNo: number; lastStop: unknown; nextStart: unknown; percent: number; pagesReadInCurrentKhatma: number; avgPagesPerDay: number;
  expectedFinishDate: string | null; streak: number; khatmasCompleted: number; today: { pages: number; goal: number; done: boolean };
}
export interface SleepLog { id: string; kind: 'night' | 'nap'; sleptAt: string; wokeAt: string | null; date: string | null; minutes: number | null; energy: number | null }
export interface SleepSummary { open: SleepLog | null; recent: SleepLog[]; targetMinutes: number; week: { nights: number; avgMinutes: number | null; napMinutes: number; debtMinutes: number }; insight: unknown }
export interface WorkWeek { start: string; end: string; goalSec: number; totalSec: number; palms: number; wilted: number; prayerBreaks: number; distractions: { total: number; returned: number }; days: { date: string; workedSec: number; palms: number; wilted: number; sessions: number }[] }
export interface WorkSession { clientId: string; date: string; startedAt: string; endedAt: string | null; workedSec: number; breakSec: number; prayerBreaks: number; distractedSec: number; wilted: number }
export interface DayClose { date: string; mood: number | null; note: string; skipped: boolean; closedAt: string }
export interface DayCloseRange { from: string; to: string; today: string; closes: DayClose[]; streak: { current: number; frozenDates: string[]; freezeAvailable: boolean } }
export interface Habit {
  id: string; name: string; kind: 'check' | 'count' | 'duration'; target: number; unit: string | null; minTarget: number | null;
  schedule: { type: 'daily' | 'weekdays' | 'perWeek'; days?: number[]; times?: number };
  value: number; done: boolean; minimum: boolean; kept: boolean; scheduledToday: boolean; archived: boolean;
  week: { kept: number; times: number } | null; streak: { current: number; unit: 'days' | 'weeks'; warning: boolean }; linked: boolean; establishing: boolean;
}
export interface HabitStats {
  consistency: number; previous: number;
  streak: { current: number; longest: number; unit: 'days' | 'weeks'; warning: boolean; nextMilestone: number | null; milestones: number[] };
  heatmap: { date: string; level: 0 | 1 | 2 | 3 }[];
}
