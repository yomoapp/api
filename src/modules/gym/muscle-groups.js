'use strict';

/** Ordered "muscle groups" a user trains one per day; shared with the app. */
const GROUPS = ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'abs'];

const MUSCLE_TO_GROUP = {
  chest: 'chest',
  lats: 'back',
  'middle back': 'back',
  'lower back': 'back',
  traps: 'back',
  shoulders: 'shoulders',
  neck: 'shoulders',
  quadriceps: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  adductors: 'legs',
  abductors: 'legs',
  biceps: 'biceps',
  forearms: 'biceps',
  triceps: 'triceps',
  abdominals: 'abs',
};

/** Group of an exercise: first mapped primary muscle, else first mapped secondary muscle, else `abs`. */
function groupFor(exercise) {
  const muscles = [...(exercise?.primaryMuscles || []), ...(exercise?.secondaryMuscles || [])];
  for (const m of muscles) {
    if (Object.hasOwn(MUSCLE_TO_GROUP, m)) return MUSCLE_TO_GROUP[m];
  }
  return 'abs';
}

module.exports = { GROUPS, groupFor };
