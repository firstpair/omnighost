import { parseYaml } from 'obsidian';
import { joinFrontmatter, splitFrontmatter, upsertFrontmatterKeys, yamlString } from './frontmatter-parser';
import type { TitlePrimarySource } from './types';
import type { ParsedTextpack } from './importers/textpack';

export interface TitleAnalysis {
	metadataTitle?: string;
	headingTitle?: string;
	fallbackTitle: string;
	hasConflict: boolean;
	defaultSource: TitlePrimarySource;
}

export interface TextpackTitleOptions {
	primarySource: TitlePrimarySource;
	updateSecondary: boolean;
}

export interface NormalizedTextpackTitle {
	title: string;
	markdown: string;
	source: TitlePrimarySource;
}

interface LeadingH1 {
	title: string;
	fullMatch: string;
}

export function analyzeTitleSources(
	content: string,
	fallbackTitle: string,
	metadataTitleOverride?: string
): TitleAnalysis {
	const metadataTitle = frontmatterTitle(content) ?? cleanTitle(metadataTitleOverride);
	const headingTitle = leadingH1(content)?.title;
	const fallback = cleanTitle(fallbackTitle) ?? 'Untitled post';

	return {
		metadataTitle,
		headingTitle,
		fallbackTitle: fallback,
		hasConflict: !!metadataTitle && !!headingTitle && titleKey(metadataTitle) !== titleKey(headingTitle),
		defaultSource: headingTitle ? 'heading' : 'metadata'
	};
}

export function analyzeTextpackTitle(pack: ParsedTextpack): TitleAnalysis {
	return analyzeTitleSources(pack.markdown, pack.name, pack.ghost.title);
}

export function resolvePrimaryTitle(analysis: TitleAnalysis, primarySource: TitlePrimarySource): string {
	if (primarySource === 'heading' && analysis.headingTitle) return analysis.headingTitle;
	if (primarySource === 'metadata' && analysis.metadataTitle) return analysis.metadataTitle;
	return analysis.headingTitle ?? analysis.metadataTitle ?? analysis.fallbackTitle;
}

export function normalizeTextpackTitle(
	pack: ParsedTextpack,
	options: TextpackTitleOptions
): NormalizedTextpackTitle {
	const analysis = analyzeTextpackTitle(pack);
	const title = resolvePrimaryTitle(analysis, options.primarySource);
	let markdown = pack.markdown;

	if (options.updateSecondary) {
		markdown = updateSecondaryTitle(markdown, title, options.primarySource);
	}

	// Imported notes always persist the chosen publishing title in frontmatter.
	markdown = upsertFrontmatterKeys(markdown, { title: yamlString(title, true) });
	markdown = removeMatchingLeadingH1(markdown, title);

	return { title, markdown, source: options.primarySource };
}

export function updateSecondaryTitle(
	content: string,
	title: string,
	primarySource: TitlePrimarySource
): string {
	if (primarySource === 'heading') {
		return upsertFrontmatterKeys(content, { title: yamlString(title, true) });
	}
	return replaceLeadingH1(content, title);
}

export function frontmatterTitle(content: string): string | undefined {
	const parsed = splitFrontmatter(content);
	if (!parsed) return undefined;

	try {
		const raw = parseYaml(parsed.raw) as unknown;
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
		return cleanTitle((raw as Record<string, unknown>).title);
	} catch {
		return undefined;
	}
}

function leadingH1(content: string): LeadingH1 | null {
	const parsed = splitFrontmatter(content);
	const body = parsed ? parsed.body : content;
	const match = body.match(/^(\s*)#\s+([^\n]+?)[ \t]*(?:\n|$)(?:[ \t]*\n)*/);
	if (!match) return null;

	const title = cleanTitle(match[2]);
	if (!title) return null;
	return { title, fullMatch: match[0] };
}

function replaceLeadingH1(content: string, title: string): string {
	const parsed = splitFrontmatter(content);
	const body = parsed ? parsed.body : content;
	const heading = leadingH1(content);
	if (!heading || !body.startsWith(heading.fullMatch)) return content;

	const nextBody = `\n# ${title}\n\n${body.slice(heading.fullMatch.length).replace(/^\n+/, '')}`;
	return parsed ? joinFrontmatter(parsed.raw, nextBody) : nextBody.replace(/^\n+/, '');
}

function removeMatchingLeadingH1(content: string, title: string): string {
	const parsed = splitFrontmatter(content);
	const body = parsed ? parsed.body : content;
	const heading = leadingH1(content);
	if (!heading || titleKey(heading.title) !== titleKey(title) || !body.startsWith(heading.fullMatch)) {
		return content;
	}

	const nextBody = `\n${body.slice(heading.fullMatch.length).replace(/^\n+/, '')}`;
	return parsed ? joinFrontmatter(parsed.raw, nextBody) : nextBody.replace(/^\n+/, '');
}

function cleanTitle(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const title = value.replace(/\s+/g, ' ').trim();
	return title || undefined;
}

function titleKey(title: string): string {
	return title.replace(/\s+/g, ' ').trim();
}
