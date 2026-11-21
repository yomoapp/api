'use strict';

/**
 * The archive catalog: every card of the "حياتي" screen and its sub-features, with stable keys shared by the API,
 * the dashboard and the app. Archiving is a UI/notification switch only: it never deletes data.
 *
 * The private space (vault, calm, hidden habits) is deliberately NOT in this catalog and can never be archived here.
 */

// [key, Arabic label, parent]
const ROWS = [
  ['work', 'تركيزي', null],
  ['listen', 'بسمع إيه؟', null],
  ['habits', 'عاداتي', null],
  ['ielts', 'IELTS', null],
  ['english', 'العب إنجليزي', null],
  ['money', 'فلوسي', null],
  ['religion', 'صلاتي ووردي', null],
  ['gym', 'الجيم', null],
  ['food', 'أكلت إيه؟', null],
  ['weight', 'الميزان', null],
  ['sleep', 'نوم وصحيان', null],
  ['out', 'برّه', null],
  // Groups, not real cards: they cannot be archived themselves, only their subs.
  ['today', 'كروت اليوم', null],
  ['me', 'أنا', null],

  ['work.music', 'شريط المزيكا', 'work'],
  ['work.week', 'تقرير الأسبوع', 'work'],
  ['work.bestHours', 'أحسن ساعاتك', 'work'],
  ['listen.screen', 'وقت الشاشة', 'listen'],
  ['listen.story', 'القصة', 'listen'],
  ['habits.routines', 'الروتينات', 'habits'],
  ['ielts.mocks', 'الامتحانات التجريبية', 'ielts'],
  ['ielts.examiner', 'الممتحن الصوتي', 'ielts'],
  ['ielts.drive', 'وضع العربية', 'ielts'],
  ['ielts.dictation', 'الإملاء', 'ielts'],
  ['ielts.fee', 'مصاريف الامتحان', 'ielts'],
  ['english.story', 'المسلسل', 'english'],
  ['english.maplepay', 'Maplepay', 'english'],
  ['english.invaders', 'Word Invaders', 'english'],
  ['english.escape', 'غرفة الهروب', 'english'],
  ['money.debts', 'ليا وعليا', 'money'],
  ['money.savings', 'بحوّش', 'money'],
  ['money.sms', 'رسايل البنك', 'money'],
  ['money.journal', 'الدفتر', 'money'],
  ['money.people', 'الناس', 'money'],
  ['religion.wird', 'الورد', 'religion'],
  ['religion.adhkar', 'الأذكار', 'religion'],
  ['religion.postPrayer', 'شاشة بعد الصلاة', 'religion'],
  ['gym.session', 'سيشن الجيم اللايف', 'gym'],
  ['gym.plan', 'الخطة', 'gym'],
  ['gym.myExercises', 'تماريني', 'gym'],
  ['gym.progress', 'التقدم', 'gym'],
  ['sleep.alarms', 'المنبهات', 'sleep'],
  ['sleep.qr', 'منبه الـQR', 'sleep'],
  ['out.car', 'العربية', 'out'],
  ['out.places', 'خريطة يومي', 'out'],
  ['out.moves', 'مشاويري', 'out'],
  ['today.work', 'كارت الشغل', 'today'],
  ['today.ielts', 'كارت IELTS', 'today'],
  ['today.trip', 'كارت المشوار', 'today'],
  ['today.sleep', 'كارت النوم', 'today'],
  ['today.dayClose', 'كارت قفلة اليوم', 'today'],
  ['today.habits', 'كارت العادات', 'today'],
  ['me.reminders', 'التذكيرات', 'me'],
  ['me.dayClose', 'قفلة اليوم', 'me'],
  ['me.quickReplies', 'الردود السريعة', 'me'],
  ['me.widget', 'الويدجت', 'me'],
];

const CATALOG = ROWS.map(([key, label, parent]) => ({ key, label, parent }));
const KEYS = new Set(CATALOG.map((r) => r.key));
const GROUP_KEYS = new Set(['today', 'me']);
// Real cards (parent null, not a group): the ones that have a "last used" date.
const CARD_KEYS = CATALOG.filter((r) => r.parent === null && !GROUP_KEYS.has(r.key)).map((r) => r.key);

// What is archived for a user who never touched the archive: their own first picks.
const DEFAULT_ARCHIVED_KEYS = [
  'habits', 'ielts', 'english', 'money.debts', 'money.savings', 'religion.postPrayer', 'food', 'weight',
  'today.ielts', 'today.habits', 'today.dayClose', 'me.dayClose',
];
// A fixed timestamp (the release day) so the defaults are stable between reads.
const DEFAULT_ARCHIVED_AT = new Date('2026-11-21T00:00:00.000Z');
const defaultArchived = () => DEFAULT_ARCHIVED_KEYS.map((key) => ({ key, at: new Date(DEFAULT_ARCHIVED_AT) }));

module.exports = { CATALOG, KEYS, GROUP_KEYS, CARD_KEYS, DEFAULT_ARCHIVED_KEYS, defaultArchived };
