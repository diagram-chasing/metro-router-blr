import type { Decider, Frequency, FunQuestion, Lifestyle, Mode } from './types';

// Q1 shows six chunky options — kept tight for the kiosk. Cab pooled and
// walk/cycle are rare answers for "most regular trip" and were dropped.
export const MODE_OPTIONS: { value: Mode; label: string; sub: string }[] = [
	{ value: 'auto', label: 'AUTO', sub: 'three-wheeler' },
	{ value: 'car', label: 'CAR', sub: 'car or cab' },
	{ value: 'two_wheeler', label: 'TWO WHEELER', sub: 'bike / scooter' },
	{ value: 'bus', label: 'BUS', sub: 'bmtc' },
	{ value: 'metro', label: 'METRO', sub: 'namma metro' }
];

export const FREQUENCY_OPTIONS: { value: Frequency; label: string; sub: string }[] = [
	{ value: 'daily', label: 'MOST DAYS', sub: "it's my commute" },
	{ value: 'few_weekly', label: 'FEW / WEEK', sub: 'a few times a week' },
	{ value: 'weekly', label: 'ONCE / WEEK', sub: 'about weekly' },
	{ value: 'occasional', label: 'NOW & THEN', sub: 'occasional' }
];

export const LIFESTYLE_OPTIONS: { value: Lifestyle; label: string; sub: string }[] = [
	{ value: 'homebody', label: 'HOMEBODY', sub: 'mostly home' },
	{ value: 'moderate', label: 'MODERATE', sub: 'a fair bit' },
	{ value: 'always_out', label: 'ALWAYS OUT', sub: 'on the move' }
];

export const DECIDER_OPTIONS: { value: Decider; label: string; sub: string }[] = [
	{ value: 'speed', label: 'SPEED', sub: 'get me there fast' },
	{ value: 'cost', label: 'COST', sub: 'keep it cheap' },
	{ value: 'comfort', label: 'COMFORT', sub: 'i like my bubble' },
	{ value: 'habit', label: 'HABIT', sub: "don't think about it" },
	{ value: 'no_option', label: 'NO OPTION', sub: 'no real alternative' }
];

export const FUN_QUESTIONS: FunQuestion[] = [
	{
		id: 'walking',
		title: 'THE COFFEE WALK',
		prompt: 'How far would you walk for really good coffee?',
		options: [
			{ label: 'TEN MIN, HAPPILY', value: 'ten' },
			{ label: 'FIVE MIN MAX', value: 'five' },
			{ label: 'DELIVERED', value: 'delivered' }
		]
	},
	{
		id: 'planning_slack',
		title: 'THE SNOOZE COUNT',
		prompt: 'Your alarm goes off. How many times do you hit snooze?',
		options: [
			{ label: 'UP ON FIRST RING', value: 'first' },
			{ label: 'TWO OR THREE', value: 'few' },
			{ label: 'SEVEN ALARMS', value: 'many' }
		]
	},
	{
		id: 'crowd_tolerance',
		title: 'CONCERT SPOT',
		prompt: 'At a concert, where are you?',
		options: [
			{ label: 'FRONT ROW, CRUSHED', value: 'front' },
			{ label: 'IN THE MIDDLE', value: 'middle' },
			{ label: 'AT THE BACK', value: 'back' }
		]
	},
	{
		id: 'boredom',
		title: 'DEAD TIME',
		prompt: 'Sitting with nothing to do. What do you do?',
		options: [
			{ label: 'DOOMSCROLL', value: 'scroll' },
			{ label: 'READ A BOOK OR PODCAST', value: 'book' },
			{ label: 'NEED TO MOVE AROUND', value: 'move' }
		]
	}
];

export function pickRandomFunQuestion(): FunQuestion {
	const idx = Math.floor(Math.random() * FUN_QUESTIONS.length);
	return FUN_QUESTIONS[idx];
}
