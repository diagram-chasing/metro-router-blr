export type Mode =
	| 'auto'
	| 'cab_solo'
	| 'cab_shared'
	| 'car'
	| 'two_wheeler'
	| 'bus'
	| 'metro'
	| 'active';

export type Frequency = 'daily' | 'few_weekly' | 'weekly' | 'occasional';
export type Lifestyle = 'homebody' | 'moderate' | 'always_out';
export type Decider = 'speed' | 'cost' | 'comfort' | 'habit' | 'no_option';
export type ChosenPreset = 'private' | 'metro_mixed' | 'metro_walk';
export type FunQuestionId =
	| 'walking'
	| 'time_pressure'
	| 'planning_slack'
	| 'crowd_tolerance'
	| 'boredom';

export type FunOption = { label: string; value: string };
export type FunQuestion = {
	id: FunQuestionId;
	title: string;
	prompt: string;
	options: FunOption[];
};

export type Answers = {
	mode?: Mode;
	frequency?: Frequency;
	origin?: [number, number];
	destination?: [number, number];
	distanceKm?: number;
	originStation?: string;
	destinationStation?: string;
	chosenPreset?: ChosenPreset;
	lifestyle?: Lifestyle;
	decider?: Decider;
	funQuestionId?: FunQuestionId;
	funAnswer?: string;
};
