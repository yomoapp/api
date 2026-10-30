'use strict';

const DEBT_CATEGORY_NAME = 'ديون';

const DEFAULTS = [
  { type: 'expense', name: 'أكل', icon: '🍽️', color: '#f97316' },
  { type: 'expense', name: 'مواصلات', icon: '🚌', color: '#0ea5e9' },
  { type: 'expense', name: 'فواتير', icon: '🧾', color: '#6366f1' },
  { type: 'expense', name: 'بيت', icon: '🏠', color: '#84cc16' },
  { type: 'expense', name: 'صحة', icon: '💊', color: '#ef4444' },
  { type: 'expense', name: 'لبس', icon: '👕', color: '#ec4899' },
  { type: 'expense', name: 'ترفيه', icon: '🎮', color: '#a855f7' },
  { type: 'expense', name: 'تعليم', icon: '📚', color: '#14b8a6' },
  { type: 'expense', name: 'هدايا وصدقات', icon: '🎁', color: '#f59e0b' },
  { type: 'expense', name: 'أخرى', icon: '📦', color: '#64748b' },
  { type: 'income', name: 'مرتب', icon: '💼', color: '#22c55e' },
  { type: 'income', name: 'شغل حر', icon: '💻', color: '#0ea5e9' },
  { type: 'income', name: 'هدية', icon: '🎁', color: '#f59e0b' },
  { type: 'income', name: 'أخرى', icon: '📦', color: '#64748b' },
];

const SYSTEM = [
  { type: 'expense', name: DEBT_CATEGORY_NAME, icon: '🤝', color: '#78716c', system: true },
  { type: 'income', name: DEBT_CATEGORY_NAME, icon: '🤝', color: '#78716c', system: true },
];

const defaultCategoriesFor = (userId) => [...DEFAULTS, ...SYSTEM].map((c) => ({ ...c, userId }));

module.exports = { DEBT_CATEGORY_NAME, SYSTEM, defaultCategoriesFor };
