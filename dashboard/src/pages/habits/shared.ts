import type { Habit } from '../../lib/types';

export interface HabitFull extends Habit {
  routineId: string | null; order: number; startDate: string;
  link: { source: string; params: Record<string, unknown> } | null;
}
export interface Routine { id: string; name: string; anchor: string; order: number }
export interface Suggestion {
  key: string; name: string; kind: Habit['kind']; target: number; unit: string | null;
  schedule: Habit['schedule']; link: { source: string; params: Record<string, unknown> };
}

export const ANCHOR_LABEL: Record<string, string> = {
  after_fajr: 'بعد الفجر', morning: 'الصبح', after_dhuhr: 'بعد الضهر', after_asr: 'بعد العصر',
  after_maghrib: 'بعد المغرب', after_isha: 'بعد العشاء', before_sleep: 'قبل النوم', anytime: 'أي وقت',
};
export const ANCHORS = Object.keys(ANCHOR_LABEL);
// Backend weekdays: 0 = Saturday ... 6 = Friday.
export const DAY_NAMES = ['السبت', 'الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة'];
export const PRAYER_NAMES: Record<string, string> = { fajr: 'الفجر', dhuhr: 'الضهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشا' };
export const LINK_LABEL: Record<string, string> = {
  prayer_mosque: 'صلاة في الجامع', adhkar_morning: 'أذكار الصباح', adhkar_evening: 'أذكار المساء',
  wird: 'الورد (صفحات)', gym: 'جيم', protein: 'بروتين', sleep_before: 'نوم قبل ميعاد',
};
