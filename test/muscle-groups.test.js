'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GROUPS, groupFor } = require('../src/modules/gym/muscle-groups');
const library = require('../src/data/exercises.json');

test('GROUPS are ordered', () => {
  assert.deepEqual(GROUPS, ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'abs']);
});

test('groupFor maps every library muscle key', () => {
  const cases = {
    chest: 'chest', lats: 'back', 'middle back': 'back', 'lower back': 'back', traps: 'back',
    shoulders: 'shoulders', neck: 'shoulders', quadriceps: 'legs', hamstrings: 'legs', glutes: 'legs',
    calves: 'legs', adductors: 'legs', abductors: 'legs', biceps: 'biceps', forearms: 'biceps',
    triceps: 'triceps', abdominals: 'abs',
  };
  for (const [muscle, group] of Object.entries(cases)) assert.equal(groupFor({ primaryMuscles: [muscle] }), group, muscle);
});

test('groupFor tries every primary muscle in order, then secondary, then falls back to abs', () => {
  assert.equal(groupFor({ primaryMuscles: ['unknown', 'triceps'], secondaryMuscles: ['chest'] }), 'triceps');
  assert.equal(groupFor({ primaryMuscles: ['unknown'], secondaryMuscles: ['x', 'calves'] }), 'legs');
  assert.equal(groupFor({ primaryMuscles: [], secondaryMuscles: [] }), 'abs');
  assert.equal(groupFor({ primaryMuscles: ['unknown'] }), 'abs');
  assert.equal(groupFor({ primaryMuscles: ['constructor'] }), 'abs');
});

test('every library exercise resolves to a known group', () => {
  for (const x of library) assert.ok(GROUPS.includes(groupFor(x)), x.id);
});
