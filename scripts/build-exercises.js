'use strict';
// Builds src/data/exercises.json (the built-in exercise library) from:
//   scripts/data/free-exercise-db.json  <- yuhonas/free-exercise-db, dist/exercises.json
//                                          https://github.com/yuhonas/free-exercise-db (Unlicense / public domain)
//   scripts/data/exercises-ar.json      <- Arabic (Egyptian gym) name for every exercise id, written for this project
// Output is compact: id, name, nameAr, equipment, primaryMuscles, secondaryMuscles, level, category, images
// (full URLs), instructions, popular. Missing equipment becomes "other".
//
// Usage: node scripts/build-exercises.js
const fs = require('node:fs');
const path = require('node:path');

const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

// Curated "popular" gym exercises (shown first in the library).
const POPULAR = [
  'Barbell_Bench_Press_-_Medium_Grip', 'Barbell_Incline_Bench_Press_-_Medium_Grip', 'Decline_Barbell_Bench_Press',
  'Close-Grip_Barbell_Bench_Press', 'Dumbbell_Bench_Press', 'Incline_Dumbbell_Press', 'Machine_Bench_Press',
  'Smith_Machine_Bench_Press', 'Dumbbell_Flyes', 'Incline_Cable_Flye', 'Cable_Crossover', 'Butterfly', 'Pushups',
  'Barbell_Squat', 'Barbell_Full_Squat', 'Front_Barbell_Squat', 'Goblet_Squat', 'Hack_Squat', 'Smith_Machine_Squat',
  'Leg_Press', 'Leg_Extensions', 'Lying_Leg_Curls', 'Seated_Leg_Curl', 'Dumbbell_Lunges', 'Barbell_Hip_Thrust',
  'Standing_Calf_Raises', 'Seated_Calf_Raise', 'Barbell_Deadlift', 'Romanian_Deadlift', 'Sumo_Deadlift',
  'Wide-Grip_Lat_Pulldown', 'Close-Grip_Front_Lat_Pulldown', 'V-Bar_Pulldown', 'Seated_Cable_Rows', 'Bent_Over_Barbell_Row',
  'One-Arm_Dumbbell_Row', 'T-Bar_Row_with_Handle', 'Straight-Arm_Pulldown', 'Pullups', 'Chin-Up', 'Face_Pull',
  'Barbell_Shoulder_Press', 'Dumbbell_Shoulder_Press', 'Seated_Dumbbell_Press', 'Machine_Shoulder_Military_Press',
  'Arnold_Dumbbell_Press', 'Side_Lateral_Raise', 'Front_Dumbbell_Raise', 'Reverse_Machine_Flyes', 'Upright_Barbell_Row',
  'Barbell_Shrug', 'Dumbbell_Shrug', 'Barbell_Curl', 'EZ-Bar_Curl', 'Dumbbell_Bicep_Curl', 'Hammer_Curls',
  'Preacher_Curl', 'Incline_Dumbbell_Curl', 'Triceps_Pushdown', 'Triceps_Pushdown_-_Rope_Attachment',
  'Triceps_Overhead_Extension_with_Rope', 'EZ-Bar_Skullcrusher', 'Dips_-_Triceps_Version', 'Dips_-_Chest_Version',
  'Bench_Dips', 'Crunches', 'Cable_Crunch', 'Hanging_Leg_Raise', 'Plank',
];

// Corrections to the source equipment tag (id -> equipment).
const EQUIPMENT_OVERRIDES = { Goblet_Squat: 'dumbbell' };

const root = path.join(__dirname, '..');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'free-exercise-db.json'), 'utf8'));
const ar = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'exercises-ar.json'), 'utf8'));

const ids = new Set(source.map((x) => x.id));
const missingPopular = POPULAR.filter((id) => !ids.has(id));
if (missingPopular.length) throw new Error(`Unknown popular ids: ${missingPopular.join(', ')}`);
if (new Set(POPULAR).size !== POPULAR.length) throw new Error('Duplicate popular ids');

const popular = new Set(POPULAR);
const out = source.map((x) => {
  const nameAr = ar[x.id];
  if (typeof nameAr !== 'string' || !/[؀-ۿ]/.test(nameAr)) throw new Error(`Missing Arabic name for ${x.id}`);
  return {
    id: x.id,
    name: x.name,
    nameAr,
    equipment: EQUIPMENT_OVERRIDES[x.id] || x.equipment || 'other',
    primaryMuscles: x.primaryMuscles,
    secondaryMuscles: x.secondaryMuscles,
    level: x.level,
    category: x.category,
    images: (x.images || []).map((p) => IMAGE_BASE + p),
    instructions: x.instructions,
    popular: popular.has(x.id),
  };
});
const extra = Object.keys(ar).filter((id) => !ids.has(id));
if (extra.length) throw new Error(`Arabic names for unknown ids: ${extra.join(', ')}`);

const seenAr = new Map();
for (const x of out) {
  if (seenAr.has(x.nameAr)) throw new Error(`Duplicate nameAr "${x.nameAr}": ${seenAr.get(x.nameAr)} and ${x.id}`);
  seenAr.set(x.nameAr, x.id);
}
const badOverrides = Object.keys(EQUIPMENT_OVERRIDES).filter((id) => !ids.has(id));
if (badOverrides.length) throw new Error(`Equipment overrides for unknown ids: ${badOverrides.join(', ')}`);

fs.writeFileSync(path.join(root, 'src', 'data', 'exercises.json'), `${JSON.stringify(out)}\n`);
console.log(`wrote ${out.length} exercises (${POPULAR.length} popular)`);
