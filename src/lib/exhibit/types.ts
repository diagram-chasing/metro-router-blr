export type Mode =
	| 'auto'
	| 'car' // private four-wheeler, owned or hailed ("car / cab")
	| 'two_wheeler'
	| 'bus'
	| 'metro'
	| 'active';

export type Frequency = 'daily' | 'few_weekly' | 'weekly' | 'occasional';
export type Lifestyle = 'homebody' | 'moderate' | 'always_out';
export type FunQuestionId = 'walking' | 'crowd_tolerance' | 'last_mile';

export type FunOption = { label: string; value: string };
export type FunQuestion = {
	id: FunQuestionId;
	title: string;
	prompt: string;
	options: FunOption[];
};

// Drawable geometry of the route the visitor chose, captured at Q3. Travels with
// the answers to the server, where it becomes the grey line on the accumulation
// map. `legKind`/`chosenKind` use the route-candidate vocabulary.
import type { CandidateKind, LegKind } from './routeCandidates';

export type RouteSegmentGeo = { coords: [number, number][]; legKind: LegKind };
export type RouteGeometry = {
	chosenKind: CandidateKind;
	segments: RouteSegmentGeo[];
};

export type Answers = {
	name?: string;
	mode?: Mode;
	frequency?: Frequency;
	origin?: [number, number];
	destination?: [number, number];
	distanceKm?: number;
	originStation?: string;
	destinationStation?: string;
	chosenRouteId?: string;
	route?: RouteGeometry;
	lifestyle?: Lifestyle;
	funQuestionId?: FunQuestionId;
	funAnswer?: string;
};
