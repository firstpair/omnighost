const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Normalize a configured Ghost site URL.
 * A bare domain like "example.com" is treated as "https://example.com".
 */
export function normalizeGhostSiteUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) return '';

	const withScheme = SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		const parsed = new URL(withScheme);
		parsed.hash = '';
		parsed.search = '';
		return parsed.toString().replace(/\/+$/, '');
	} catch {
		return withScheme;
	}
}

export function ghostHostname(url: string): string {
	try {
		return new URL(normalizeGhostSiteUrl(url)).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return '';
	}
}

export function buildGhostEditorUrl(ghostSiteUrl: string, postId: string): string {
	return `${normalizeGhostSiteUrl(ghostSiteUrl)}/ghost/#/editor/post/${postId}`;
}
