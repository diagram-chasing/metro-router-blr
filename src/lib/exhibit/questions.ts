import type { Frequency, FunQuestion, JourneyType, Lifestyle } from './types';

// Step prompts (map first, then the single journey choice)
export const PROMPTS: Record<number, string> = {
	1: 'Drop two pins to trace your most regular trip across the city.',
	2: 'How do you usually make this trip?',
	3: 'How often is that trip?',
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

// The single journey the visitor picks — realistic door-to-door options, not abstract
// single modes. The two metro options carry their access leg (see journeyEmissions).
export const JOURNEY_OPTIONS: { value: JourneyType; label: string; sub: string }[] = [
	{ value: 'two_wheeler', label: 'TWO WHEELER', sub: 'bike / scooter' },
	{ value: 'car', label: 'CAR', sub: 'car or cab' },
	{ value: 'car_ev', label: 'EV CAR', sub: 'electric' },
	{ value: 'bus', label: 'BUS', sub: 'bmtc' },
	{ value: 'metro_auto', label: 'METRO + AUTO', sub: 'auto to the station' },
	{ value: 'metro_walk', label: 'METRO + WALK', sub: 'walk to the station' }
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
