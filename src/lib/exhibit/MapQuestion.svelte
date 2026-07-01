<script lang="ts">
	import { onMount } from 'svelte';

	import { browser } from '$app/environment';

	import Map from '$lib/components/Map.svelte';
	import { firstWithMode, planAllModes, type PlanBundle } from '$lib/utils/otp';

	import { COPY } from './questions';
	import { buildOtpCandidates, stationNames, tripDistanceKm } from './routeCandidates';
	import type { JourneyType } from './types';
	import XpProgress from './XpProgress.svelte';
	import { answers, setAnswer } from './store.svelte';

	let originPick = $state<[number, number] | null>(answers.origin ?? null);
	let destinationPick = $state<[number, number] | null>(answers.destination ?? null);
	let bundle = $state<PlanBundle | null>(null);
	let isLoading = $state(false);
	let lastError = $state<string | null>(null);

	const statusLabel = $derived(
		!originPick ? COPY.mapSetOrigin : !destinationPick ? COPY.mapSetDestination : COPY.mapDistance
	);

	// The visitor no longer picks a route: the map just needs geometry. Draw the same
	// canonical path we store for the receipt (auto-set in calculate()).
	const candidates = $derived(bundle ? buildOtpCandidates(answers, bundle) : []);
	const drawnCandidate = $derived(
		candidates.find((c) => c.id === answers.chosenRouteId) ?? candidates[0] ?? null
	);
	const mapSegments = $derived(drawnCandidate?.segments ?? null);

	async function handlePick(e: CustomEvent<{ lng: number; lat: number }>) {
		if (isLoading) return;
		const point: [number, number] = [e.detail.lng, e.detail.lat];

		if (!originPick) {
			originPick = point;
			setAnswer('origin', point);
			return;
		}
		if (!destinationPick) {
			destinationPick = point;
			setAnswer('destination', point);
			await calculate();
		}
	}

	async function calculate() {
		if (!browser || !originPick || !destinationPick) return;
		try {
			isLoading = true;
			lastError = null;

			const b = await planAllModes(originPick, destinationPick);
			bundle = b;

			const hasAny =
				b.metro.length > 0 || b.bus.length > 0 || b.car.length > 0 || b.walk.length > 0;
			if (!hasAny) {
				lastError = COPY.mapNoRoute;
				return;
			}

			const dist = tripDistanceKm(b);
			if (dist > 0) setAnswer('distanceKm', dist);

			const stns = stationNames(b);
			setAnswer('originStation', stns.origin);
			setAnswer('destinationStation', stns.destination);

			// Which journeys are actually feasible here, from what OTP found. Road modes
			// are always possible; bus and the metro combos only when an itinerary really
			// contains that transit leg. OTP returns a walk-only fallback when no transit
			// serves the trip, so a non-empty array is NOT enough — check for the leg.
			const avail: JourneyType[] = ['two_wheeler', 'car', 'car_ev'];
			if (firstWithMode(b.bus, 'BUS')) avail.push('bus');
			if (firstWithMode(b.metro, 'SUBWAY')) avail.push('metro_auto', 'metro_walk');
			setAnswer('availableModes', avail);
			// Drop a previously chosen mode that this trip can't actually support.
			if (answers.mode && !avail.includes(answers.mode)) setAnswer('mode', undefined);

			// Geometry only: keep one canonical path (prefer the full road route) to draw
			// the map and ground the corridor. The chosen JOURNEY (Q2) drives emissions;
			// this route's mode is never treated as a second choice to compare against.
			const cands = buildOtpCandidates(answers, b);
			const canon = cands.find((c) => c.kind === 'cab' || c.kind === 'auto') ?? cands[0];
			if (canon?.segments) {
				setAnswer('chosenRouteId', canon.id);
				setAnswer('route', {
					chosenKind: canon.kind,
					segments: canon.segments.map((s) => ({ coords: s.coords, legKind: s.kind }))
				});
			}
		} catch (err) {
			console.error('Journey calculation failed:', err);
			lastError = err instanceof Error ? err.message : COPY.mapFailed;
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		if (originPick && destinationPick) {
			void calculate();
		}
	});

	function clear() {
		originPick = null;
		destinationPick = null;
		bundle = null;
		lastError = null;
		setAnswer('origin', undefined);
		setAnswer('destination', undefined);
		setAnswer('distanceKm', undefined);
		setAnswer('originStation', undefined);
		setAnswer('destinationStation', undefined);
		setAnswer('chosenRouteId', undefined);
		setAnswer('route', undefined);
		setAnswer('availableModes', undefined);
	}
</script>

<div class="relative min-h-0 min-w-0 flex-1">
	<div
		class="absolute inset-0 overflow-hidden rounded-[3px] border border-[#7f9db9] bg-white shadow-[inset_1px_1px_3px_rgba(0,0,0,0.25)]"
	>
		<Map {originPick} {destinationPick} segments={mapSegments} on:pick={handlePick} />
	</div>

	<!-- Slim Luna title bar, reused by the HUD + the two overlays below. -->
	{#snippet titlebar(text: string)}
		<div
			class="flex items-center border-b border-[#003ad6] bg-gradient-to-b from-[#0e6fff] via-[#1f60e5] to-[#0a53d6] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
		>
			<img src="/xp/readme.ico" alt="" class="mr-1.5 h-4 w-4 shrink-0 drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]" />
			<span class="truncate text-[13px] font-bold text-white drop-shadow-[1px_1px_1px_rgba(0,0,0,0.55)]">
				{text}
			</span>
		</div>
	{/snippet}

	<!-- ── HUD: XP window — ○━━○ schematic + sunken distance readout + clear ── -->
	<div
		class="font-xp absolute bottom-5 left-1/2 min-w-[440px] max-w-[92%] -translate-x-1/2 overflow-hidden rounded-[4px] border-[2px] border-[#0054e3] bg-[#ece9d8] shadow-[3px_3px_12px_rgba(0,0,0,0.4)] transition-opacity duration-200 {isLoading
			? 'opacity-70'
			: ''}"
	>
		{@render titlebar(statusLabel)}

		<div class="flex items-center gap-5 px-5 py-3.5">
			<div class="flex shrink-0 items-center" aria-hidden="true">
				<span
					class="h-[14px] w-[14px] rounded-full border-2 transition-colors duration-200 {originPick
						? 'border-black bg-black'
						: 'border-[#9a9a8c] bg-transparent'}"
				></span>
				<span
					class="h-[3px] w-9 transition-colors duration-200 {originPick && destinationPick
						? 'bg-black'
						: 'bg-[#9a9a8c]'}"
				></span>
				<span
					class="h-[14px] w-[14px] rounded-full border-2 transition-colors duration-200 {destinationPick
						? 'border-black bg-black'
						: 'border-[#9a9a8c] bg-transparent'}"
				></span>
			</div>

			<div
				class="flex min-w-0 flex-1 items-baseline justify-center gap-2 rounded-[3px] border border-[#7f9db9] bg-white px-4 py-2 leading-none shadow-[inset_1px_1px_2px_rgba(0,0,0,0.22)] [font-variant-numeric:tabular-nums]"
			>
				{#if answers.distanceKm}
					<span class="text-[32px] font-bold text-black">{answers.distanceKm.toFixed(2)}</span>
					<span class="text-[15px] text-[#6a6a5e]">km</span>
				{:else}
					<span class="text-[32px] font-bold text-[#b8b4a4]">--.--</span>
					<span class="text-[15px] text-[#b8b4a4]">km</span>
				{/if}
			</div>

			{#if originPick || destinationPick}
				<button
					type="button"
					onclick={clear}
					disabled={isLoading}
					aria-label="Clear pins"
					title="Clear pins"
					class="flex h-11 shrink-0 items-center gap-2 rounded-[3px] border border-[#003c74] bg-gradient-to-b from-white via-[#ecebe5] to-[#d8d0c4] px-4 text-[14px] font-bold text-[#003366] active:bg-gradient-to-b active:from-[#cdcac3] active:to-[#f2f2f1] disabled:opacity-40"
				>
					<svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true">
						<path
							d="M3 3 L11 11 M11 3 L3 11"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					</svg>
					Clear
				</button>
			{/if}
		</div>
	</div>

	{#if isLoading}
		<div class="absolute inset-0 grid place-items-center bg-black/25">
			<div
				class="font-xp w-[min(460px,80%)] overflow-hidden rounded-[4px] border-[2px] border-[#0054e3] bg-[#ece9d8] shadow-[4px_4px_16px_rgba(0,0,0,0.5)]"
			>
				{@render titlebar('Please wait')}
				<div class="flex flex-col gap-4 px-7 py-6">
					<span class="text-center text-[18px] font-bold text-[#003366]">{COPY.mapCrunching}</span>
					<XpProgress indeterminate />
				</div>
			</div>
		</div>
	{/if}

	{#if lastError}
		<div
			class="font-xp absolute left-1/2 top-5 w-[min(340px,80%)] -translate-x-1/2 overflow-hidden rounded-[4px] border-[2px] border-[#0054e3] bg-[#ece9d8] shadow-[3px_3px_10px_rgba(0,0,0,0.45)]"
		>
			{@render titlebar('Problem')}
			<div class="px-4 py-3 text-[13px] font-bold text-[#b52012]">{lastError}</div>
		</div>
	{/if}
</div>
