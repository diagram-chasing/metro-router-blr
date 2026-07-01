export type Mode =
	| 'auto'
	| 'car' // private four-wheeler, owned or hailed ("car / cab")
	| 'two_wheeler'
	| 'bus'
	| 'metro'
	| 'active';

// What the visitor actually picks: a door-to-door journey, not a single vehicle.
// The two metro options carry a realistic access leg (auto or walk) over the first/
// last mile, so their per-km intensity is distance-dependent (see journeyEmissions).
export type JourneyType =
	| 'two_wheeler'
	| 'car'
	| 'car_ev'
	| 'bus'
	| 'metro_auto'
	| 'metro_walk';

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
	mode?: JourneyType;
	// Which journeys OTP actually found for this origin→destination, so the mode step
	// only offers feasible options (no metro where no metro serves the trip). Set on the
	// map step from the OTP plan bundle.
	availableModes?: JourneyType[];
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
