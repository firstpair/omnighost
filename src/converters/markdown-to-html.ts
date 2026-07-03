/**
 * Content helpers shared by the sync path: paywall-marker normalization and
 * slug generation. (The old markdownToHtml converter lived here; the live
 * sync path converts via markdown-to-lexical instead.)
 */

/**
 * Ensure at most one --members-only-- marker exists in the content.
 * If multiple are found, keeps only the last one and removes the others.
 * Returns the cleaned content (or the original if zero or one marker).
 */
export function normalizePaywallMarker(content: string): string {
	const MARKER = '--members-only--';
	const lines = content.split('\n');
	const markerIndices: number[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === MARKER) {
			markerIndices.push(i);
		}
	}

	if (markerIndices.length <= 1) return content;

	// Keep only the last marker — remove all earlier ones
	const toRemove = new Set(markerIndices.slice(0, -1));
	return lines.filter((_, i) => !toRemove.has(i)).join('\n');
}

/**
 * Generate slug from title.
 *
 * Steps:
 * 1. NFD-normalise to decompose accented characters (é → e + ́)
 * 2. Strip combining diacritical marks (Unicode category Mn) so that
 *    accented letters become their ASCII base (é → e, ã → a, ç → c).
 * 3. Lowercase and replace any run of non-alphanumeric chars with a hyphen.
 * 4. Trim leading/trailing hyphens.
 *
 * Examples:
 *   "Três Níveis" → "tres-niveis"
 *   "Parte 2: Três Níveis"  → "parte-2-tres-niveis"
 */
export function generateSlug(title: string): string {
	return title
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
