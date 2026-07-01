// Permutation harness for the commute receipt. Renders every decision-driving
// combination of answers through the real compute + view + op-list pipeline, flags
// problems (leftover tokens, tone/relationship leaks, over-length, missing data),
// collapses the matrix to one representative per branch-signature, and audits every
// distinct copy line per beat so tone can be scanned at a glance.
//
//   pnpm receipts:matrix   →   scripts/out/receipt-matrix.md
//
// DB-free: comparison data is synthesised (see $lib/receipt/_fixtures).

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	buildCase,
	USUAL_MODES,
	PICKED,
	TRIPS,
	DATA_STATES,
	FREQUENCIES,
	LIFESTYLES,
	FUN,
	SEEDS,
	type Case,
	type Combo
} from '../src/lib/receipt/_fixtures';
import { buildReceiptOps, type PrintOp } from '../src/lib/receipt/receiptOps';

const COLS = 48;
const LEN_BUDGET = 130; // approx paper rows before we call the receipt "long"
const MAX_REPRESENTATIVES = 80;

const CRITICAL_PHRASES = [
	'dirtiest',
	'the worst',
	'you found the floor',
	"i'd hoped to be wrong",
	'dirtier per km',
	'heaviest per km',
	'partial credit'
];

// ── op-list → text + size ──

function center(s: string, cols = COLS): string {
	if (s.length >= cols) return s;
	const pad = cols - s.length;
	const l = Math.floor(pad / 2);
	return ' '.repeat(l) + s;
}

function opsToText(ops: PrintOp[]): string {
	const lines: string[] = [];
	for (const op of ops) {
		switch (op.t) {
			case 'text': {
				let s = op.s ?? '';
				const big = (op.w ?? 1) > 1 || (op.h ?? 1) > 1;
				if (big) s = s.toUpperCase();
				if (op.rev) s = `▌${s.trim()}▐`;
				if (op.align === 'center') s = center(s);
				else if (op.align === 'right') s = s.padStart(COLS);
				lines.push(s);
				break;
			}
			case 'rule':
				lines.push('-'.repeat(COLS));
				break;
			case 'gap':
				for (let i = 0; i < (op.n ?? 1); i++) lines.push('');
				break;
			case 'img':
				lines.push(`[[ ${op.id} ]]`);
				break;
			case 'qr':
				lines.push('[[ qr ]]');
				break;
			case 'cut':
				lines.push('────────────── ✂ ──────────────');
				break;
		}
	}
	return lines.join('\n');
}

// Approximate vertical paper rows (tall text counts h rows; images take real space).
function paperRows(ops: PrintOp[]): number {
	let r = 0;
	for (const op of ops) {
		if (op.t === 'text') r += op.h ?? 1;
		else if (op.t === 'rule') r += 1;
		else if (op.t === 'gap') r += op.n ?? 1;
		else if (op.t === 'img') r += 8;
		else if (op.t === 'qr') r += 8;
	}
	return r;
}

// ── flags ──

function flagsFor(cse: Case, text: string, rows: number): string[] {
	const f: string[] = [];
	const { view, valence } = cse;
	if (cse.combo.dataState === 'empty') f.push('EMPTY_DATA');
	if (cse.combo.dataState === 'sparse') f.push('SPARSE_DATA');
	if (/\{[a-zA-Z]+\}/.test(text)) f.push('MISSING_INTERP');
	if (rows > LEN_BUDGET) f.push('LEN');
	if (valence === 'affirm') {
		const verdict = [view.modeRank.copy, view.corridor.copy].join(' ').toLowerCase();
		if (CRITICAL_PHRASES.some((p) => verdict.includes(p))) f.push('TONE?');
	}
	return f;
}

function comboLabel(c: Combo): string {
	return `${c.usualMode} | drew:${c.pickedKind} | ${c.tripName}(${c.distanceKm}km) | ${c.frequency} | ${c.dataState} | ${c.seedId}`;
}

function signature(cse: Case): string {
	const { computed, view, valence } = cse;
	const rankTier = computed.modeRank.isClean
		? 'clean'
		: computed.modeRank.carbonRankFromDirtiest === 1
			? 'dirtiest'
			: 'dirty';
	return [
		valence,
		cse.combo.usualMode,
		cse.combo.dataState,
		view.modeRank.histogram ? 'H' : '-',
		rankTier
	].join(' | ');
}

// ── build the matrix ──

const cases: Case[] = [];
let idx = 0;
for (const usualMode of USUAL_MODES)
	for (const pickedKind of PICKED)
		for (const trip of TRIPS)
			for (const dataState of DATA_STATES) {
				const fun = FUN[idx % FUN.length];
				cases.push(
					buildCase({
						usualMode,
						pickedKind,
						distanceKm: trip.km,
						tripName: trip.name,
						frequency: FREQUENCIES[idx % FREQUENCIES.length],
						lifestyle: LIFESTYLES[idx % LIFESTYLES.length],
						funQuestionId: fun.id,
						funAnswer: fun.ans,
						dataState,
						seedId: SEEDS[idx % SEEDS.length]
					})
				);
				idx++;
			}

type Scored = { cse: Case; text: string; rows: number; flags: string[]; sig: string };
const scored: Scored[] = cases.map((cse) => {
	const ops = buildReceiptOps(cse.view);
	const text = opsToText(ops);
	const rows = paperRows(ops);
	return { cse, text, rows, flags: flagsFor(cse, text, rows), sig: signature(cse) };
});

// ── aggregates ──

const flagCounts: Record<string, number> = {};
for (const s of scored) for (const fl of s.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1;

const offenders = (flag: string) => scored.filter((s) => s.flags.includes(flag));
const missingInterp = offenders('MISSING_INTERP');
const toneLeaks = offenders('TONE?');
const overLen = [...scored].sort((a, b) => b.rows - a.rows);
const maxRows = overLen[0]?.rows ?? 0;
const overBudget = scored.filter((s) => s.rows > LEN_BUDGET);

// valence × journey matrix
const vmatrix: Record<string, Record<string, number>> = {};
for (const s of scored) {
	const v = s.cse.valence;
	const d = s.cse.combo.usualMode;
	(vmatrix[v] ??= {})[d] = ((vmatrix[v] ??= {})[d] ?? 0) + 1;
}

// representatives: first case per signature
const reps = new Map<string, Scored>();
for (const s of scored) if (!reps.has(s.sig)) reps.set(s.sig, s);

// pool audit: distinct copy per beat × context, swept across ALL seeds for each rep
const audit = new Map<string, Set<string>>();
const addAudit = (key: string, line?: string | null) => {
	if (!line) return;
	(audit.get(key) ?? audit.set(key, new Set()).get(key)!).add(line);
};
for (const rep of reps.values()) {
	for (const seedId of SEEDS) {
		const c = buildCase({ ...rep.cse.combo, seedId });
		const v = c.valence;
		addAudit(`modeRank · ${v}`, c.view.modeRank.copy);
		addAudit(`corridor · ${v}`, c.view.corridor.copy);
		addAudit(`parking · ${v}`, c.view.parking.copy);
		addAudit('cleanerNote', c.view.modeRank.cleanerNote);
		addAudit('year (clean)', c.view.year.copy || null);
		addAudit('units (clean)', c.view.units.copy || null);
	}
}

// ── render the report ──

const out: string[] = [];
const h = (s: string) => out.push(s);

h('# Receipt permutation matrix\n');
h(`Generated from \`scripts/receiptMatrix.ts\` over the real compute + view + op-list pipeline.\n`);
h(`- **Cases:** ${scored.length}`);
h(`- **Unique branch-signatures:** ${reps.size}`);
h(`- **Length budget:** ${LEN_BUDGET} rows · **longest receipt:** ${maxRows} rows · **over budget:** ${overBudget.length}\n`);

h('## Flag counts\n');
h('| Flag | Count | Meaning |');
h('| --- | --- | --- |');
const FLAG_DOC: Record<string, string> = {
	EMPTY_DATA: 'no comparison population (<5) — histogram + distribution hidden',
	SPARSE_DATA: 'distribution-only fallback (no histogram)',
	MISSING_INTERP: '⚠ leftover {token} in output — a real bug',
	LEN: `receipt exceeds ${LEN_BUDGET} rows`,
	'TONE?': '⚠ heuristic: affirm receipt carrying a critical phrase'
};
for (const [fl, n] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1]))
	h(`| \`${fl}\` | ${n} | ${FLAG_DOC[fl] ?? ''} |`);
h('');

h('## Correctness checks\n');
h(`- **MISSING_INTERP:** ${missingInterp.length === 0 ? '✅ none' : `❌ ${missingInterp.length}`}`);
for (const s of missingInterp.slice(0, 20)) h(`  - ${comboLabel(s.cse.combo)}`);
h(`- **TONE? leaks:** ${toneLeaks.length === 0 ? '✅ none' : `⚠ ${toneLeaks.length}`}`);
for (const s of toneLeaks.slice(0, 20)) h(`  - ${comboLabel(s.cse.combo)} — "${s.cse.view.modeRank.copy}"`);
h('');
h('### Longest receipts');
for (const s of overLen.slice(0, 8)) h(`- ${s.rows} rows — ${comboLabel(s.cse.combo)}`);
h('');

h('## Valence × journey matrix\n');
const dirs = USUAL_MODES as string[];
h(`| valence | ${dirs.join(' | ')} |`);
h(`| --- | ${dirs.map(() => '---').join(' | ')} |`);
for (const v of ['affirm', 'critical'])
	h(`| ${v} | ${dirs.map((d) => vmatrix[v]?.[d] ?? 0).join(' | ')} |`);
h('');

h('## Pool audit (distinct printed copy by beat × context)\n');
h('_Scan each block for a line whose tone fights its context._\n');
for (const key of [...audit.keys()].sort()) {
	const lines = [...audit.get(key)!].sort();
	h(`### ${key}  _(${lines.length})_`);
	for (const l of lines) h(`- ${l}`);
	h('');
}

h('## Representative receipts (one per branch-signature)\n');
const repList = [...reps.values()].sort((a, b) => a.sig.localeCompare(b.sig));
for (const s of repList.slice(0, MAX_REPRESENTATIVES)) {
	h(`### \`${s.sig}\``);
	h(`${comboLabel(s.cse.combo)}  \n_flags: ${s.flags.join(', ') || 'none'} · ${s.rows} rows_\n`);
	h('```');
	h(s.text);
	h('```\n');
}
if (repList.length > MAX_REPRESENTATIVES)
	h(`_…${repList.length - MAX_REPRESENTATIVES} more signatures not shown (raise MAX_REPRESENTATIVES)._`);

const target = resolve(process.cwd(), 'scripts/out/receipt-matrix.md');
mkdirSync(resolve(process.cwd(), 'scripts/out'), { recursive: true });
writeFileSync(target, out.join('\n'), 'utf8');

console.log(`receipt-matrix: ${scored.length} cases, ${reps.size} signatures → ${target}`);
console.log(
	`flags: ${Object.entries(flagCounts)
		.map(([k, v]) => `${k}=${v}`)
		.join('  ')}`
);
console.log(`longest receipt: ${maxRows} rows (budget ${LEN_BUDGET}); over budget: ${overBudget.length}`);
if (missingInterp.length) console.log(`⚠ MISSING_INTERP in ${missingInterp.length} cases`);
if (toneLeaks.length) console.log(`⚠ TONE? leaks in ${toneLeaks.length} cases`);
