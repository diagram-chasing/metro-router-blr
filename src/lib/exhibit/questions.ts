import type { Frequency, FunQuestion, Lifestyle, Mode } from './types';

// Step prompts
export const PROMPTS: Record<number, string> = {
	1: 'When you make your most regular trip across the city, how do you usually get there?',
	2: 'How often is that trip?',
	3: "Drop two pins. Then pick how you'd make this trip.",
	4: 'Apart from that trip, how much are you out in a normal week?'
};

export const COPY = {
	namePrompt: 'First, what should we call you?',
	namePlaceholder: 'Your first name',
	start: "LET'S GO",
	print: 'PRINT RECEIPT',
	printing: 'PRINTING…',
	submitFailed: 'SUBMIT FAILED:',
	// Map question (Q3)
	mapSetOrigin: 'Tap map to set origin',
	mapSetDestination: 'Tap to set destination',
	mapDistance: 'Total distance',
	mapCrunching: 'CRUNCHING ROUTE…',
	mapNoRoute: 'Could not find a route, try different pins.',
	mapFailed: 'Route calculation failed.',
	// Route options panel
	routeTitle: 'CHOOSE A ROUTE',
	routeDropPins: 'DROP TWO PINS',
	routeNoOptions: 'NO USABLE OPTIONS FOR THIS ROUTE'
};

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
		id: 'last_mile',
		title: 'THE LAST MILE',
		prompt: 'Fifteen minutes on foot, or a forty-rupee auto. You…',
		options: [
			{ label: 'WALK IT', value: 'walk' },
			{ label: 'DEPENDS ON THE DAY', value: 'depends' },
			{ label: 'ALWAYS THE AUTO', value: 'auto' }
		]
	}
];

export function pickRandomFunQuestion(): FunQuestion {
	const idx = Math.floor(Math.random() * FUN_QUESTIONS.length);
	return FUN_QUESTIONS[idx];
}
