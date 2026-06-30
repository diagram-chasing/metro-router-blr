<script lang="ts">
	import { onMount } from 'svelte';

	import { browser } from '$app/environment';

	import Map from '$lib/components/Map.svelte';
	import { planAllModes, type PlanBundle } from '$lib/utils/otp';

	import { COPY } from './questions';
	import { buildOtpCandidates, stationNames, tripDistanceKm } from './routeCandidates';
	import RouteOptions from './RouteOptions.svelte';
	import XpProgress from './XpProgress.svelte';
	import { answers, setAnswer } from './store.svelte';

	let originPick = $state<[number, number] | null>(answers.origin ?? null);
	let destinationPick = $state<[number, number] | null>(answers.destination ?? null);
	let bundle = $state<PlanBundle | null>(null);
	let isLoading = $state(false);
	let lastError = $state<string | null>(null);

	const routeReady = $derived(!!originPick && !!destinationPick && !!bundle);

	const statusLabel = $derived(
		!originPick ? COPY.mapSetOrigin : !destinationPick ? COPY.mapSetDestination : COPY.mapDistance
	);

	const candidates = $derived(bundle ? buildOtpCandidates(answers, bundle) : []);

	const selectedCandidate = $derived(
		candidates.find((c) => c.id === answers.chosenRouteId) ?? null
	);
	// When the user hasn't picked yet, preview the top candidate so the map
	// isn't blank between dropping pins and tapping a card. Selection state in
	// the panel UI stays driven by chosenRouteId only.
	const previewCandidate = $derived(selectedCandidate ?? candidates[0] ?? null);

	// The map renders the previewed candidate's real OTP geometry, leg by leg.
	const mapSegments = $derived(previewCandidate?.segments ?? null);

	// Record the picked card AND its drawable geometry in one go. The geometry
	// travels with the submission and becomes the grey line on the home-page map.
	// Done in the click handler (not an $effect) so writing answers.route can't
	// feed back into the candidate derivation and loop.
	function selectRoute(id: string) {
		setAnswer('chosenRouteId', id);
		const c = candidates.find((x) => x.id === id);
		if (c?.segments) {
			setAnswer('route', {
				chosenKind: c.kind,
				segments: c.segments.map((s) => ({ coords: s.coords, legKind: s.kind }))
			});
		}
	}

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
	}
</script>

<div class="relative flex min-h-0 flex-1 gap-3">
	<div
		class="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[3px] border border-[#7f9db9] bg-white shadow-[inset_1px_1px_3px_rgba(0,0,0,0.25)]"
	>
		<Map {originPick} {destinationPick} segments={mapSegments} on:pick={handlePick} />

		<!-- ── HUD: ○━━○ schematic + distance readout, XP group box ── -->
		<div
			class="font-xp absolute bottom-4 left-1/2 flex min-w-[320px] -translate-x-1/2 items-center gap-4 rounded-[3px] border border-[#aca899] bg-[#ece9d8] px-4 py-2 shadow-[2px_2px_6px_rgba(0,0,0,0.4)] transition-opacity duration-200 {isLoading
				? 'opacity-60'
				: ''}"
		>
			<div class="flex shrink-0 items-center" aria-hidden="true">
				<span
					class="h-[10px] w-[10px] rounded-full border-[1.5px] transition-colors duration-200 {originPick
						? 'border-[#0a53d6] bg-[#0a53d6]'
						: 'border-[#9a9a8c] bg-transparent'}"
				></span>
				<span
					class="h-[2px] w-6 transition-colors duration-200 {originPick && destinationPick
						? 'bg-[#0a53d6]'
						: 'bg-[#9a9a8c]'}"
				></span>
				<span
					class="h-[10px] w-[10px] rounded-full border-[1.5px] transition-colors duration-200 {destinationPick
						? 'border-[#0a53d6] bg-[#0a53d6]'
						: 'border-[#9a9a8c] bg-transparent'}"
				></span>
			</div>

			<div class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
				<div class="flex items-baseline gap-1.5 leading-none [font-variant-numeric:tabular-nums]">
					{#if answers.distanceKm}
						<span class="text-[22px] font-bold text-black">{answers.distanceKm.toFixed(2)}</span>
						<span class="text-[12px] text-[#6a6a5e]">km</span>
					{:else}
						<span class="text-[22px] font-bold text-[#b8b4a4]">--.--</span>
						<span class="text-[12px] text-[#b8b4a4]">km</span>
					{/if}
				</div>
				<span
					class="text-[10px] font-semibold uppercase leading-none tracking-[0.12em] text-[#5a564a]"
				>
					{statusLabel}
				</span>
			</div>

			{#if originPick || destinationPick}
				<button
					type="button"
					onclick={clear}
					disabled={isLoading}
					aria-label="Clear pins"
					title="Clear pins"
					class="grid h-7 w-7 shrink-0 place-items-center rounded-[3px] border border-[#003c74] bg-[#f4f4f4] text-[#003366] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-[#e9e9e9] active:bg-[#d4d4d4] disabled:opacity-40"
				>
					<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
						<path
							d="M3 3 L11 11 M11 3 L3 11"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			{/if}
		</div>

		{#if isLoading}
			<div
				class="font-xp absolute left-1/2 top-4 flex w-[min(300px,72%)] -translate-x-1/2 flex-col gap-2 rounded-[3px] border border-[#aca899] bg-[#ece9d8] px-4 py-3 shadow-[2px_2px_6px_rgba(0,0,0,0.4)]"
			>
				<span class="text-[12px] font-semibold text-[#003366]">{COPY.mapCrunching}</span>
				<XpProgress indeterminate />
			</div>
		{/if}

		{#if lastError}
			<div
				class="font-xp absolute right-4 top-4 max-w-[280px] rounded-[3px] border border-[#aca899] bg-[#ece9d8] px-3 py-2.5 text-[12px] font-semibold text-[#b52012] shadow-[2px_2px_6px_rgba(0,0,0,0.4)]"
			>
				{lastError}
			</div>
		{/if}
	</div>

	<RouteOptions
		{candidates}
		selectedId={answers.chosenRouteId}
		locked={!routeReady}
		onSelect={selectRoute}
	/>
</div>
