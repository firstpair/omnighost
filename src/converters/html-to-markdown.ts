/**
 * Convert Ghost HTML to Obsidian Markdown
 *
 * Handles the common HTML elements Ghost produces so content
 * imported from Ghost is readable and editable in Obsidian.
 */

/**
 * Convert a Ghost HTML string to Markdown.
 */
export function htmlToMarkdown(html: string): string {
	if (!html || html.trim() === '') return '';

	let md = html;

	// ── Normalise line endings ──────────────────────────────────────────────
	md = md.replace(/\r\n/g, '\n');

	// ── Code blocks (must come before inline-code / paragraph handling) ────
	// <pre><code class="language-js">…</code></pre>
	md = md.replace(
		/<pre[^>]*><code(?:\s+class="language-([^"]*)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
		(_: string, lang: string | undefined, code: string) => {
			const language = lang ?? '';
			// Keep the closing fence on its own line. Without the trailing blank
			// line, the next Ghost block is appended to the fence and remains code.
			return `\`\`\`${language}\n${unescapeHtml(code.trim())}\n\`\`\`\n\n`;
		}
	);

	// ── Headings ────────────────────────────────────────────────────────────
	md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_: string, t: string) => `# ${stripTags(t).trim()}\n`);
	md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_: string, t: string) => `## ${stripTags(t).trim()}\n`);
	md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_: string, t: string) => `### ${stripTags(t).trim()}\n`);
	md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_: string, t: string) => `#### ${stripTags(t).trim()}\n`);
	md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_: string, t: string) => `##### ${stripTags(t).trim()}\n`);
	md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_: string, t: string) => `###### ${stripTags(t).trim()}\n`);

	// ── Blockquotes ─────────────────────────────────────────────────────────
	md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_: string, inner: string) => {
		const text = inner
			.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
			.replace(/<br[^>]*\/?>/gi, '\n');
		const quoted = stripTags(text).trim()
			.split('\n')
			.map(line => line.trim() ? `> ${line.trim()}` : '>')
			.join('\n');

		// A blank line is required after a Markdown blockquote. Without it, the
		// following paragraph is parsed as a lazy continuation of the quote.
		return `${quoted}\n\n`;
	});

	// ── Lists ───────────────────────────────────────────────────────────────
	// Unordered
	md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner: string) => {
		return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) =>
			`- ${stripTags(item).trim()}`
		) + '\n';
	});

	// Ordered
	md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
		let index = 1;
		return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) =>
			`${index++}. ${stripTags(item).trim()}`
		) + '\n';
	});

	// ── Images ──────────────────────────────────────────────────────────────
	md = md.replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
	md = md.replace(/<img[^>]+alt="([^"]*)"[^>]+src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
	md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

	// ── Figures (Ghost wraps images in <figure>) ─────────────────────────
	md = md.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_: string, inner: string) => {
		// figcaption becomes italic text under the image
		const captionMatch = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
		const imgMd = inner.replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '').trim();
		const captionText = captionMatch ? `\n*${stripTags(captionMatch[1]).trim()}*` : '';
		return `${imgMd}${captionText}\n`;
	});

	// ── Inline formatting ───────────────────────────────────────────────────
	md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
	md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
	md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
	md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
	md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~');
	md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~');
	md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

	// ── Links ───────────────────────────────────────────────────────────────
	md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

	// ── Horizontal rules ────────────────────────────────────────────────────
	md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n');

	// ── Line breaks ─────────────────────────────────────────────────────────
	md = md.replace(/<br[^>]*\/?>/gi, '\n');

	// ── Paragraphs ──────────────────────────────────────────────────────────
	md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_: string, inner: string) => {
		const text = inner.trim();
		return text ? `${text}\n\n` : '';
	});

	// ── Divs / sections (generic block wrappers) ────────────────────────────
	md = md.replace(/<\/?(div|section|article|aside|header|footer|main|nav)[^>]*>/gi, '\n');

	// ── Strip any remaining HTML tags ───────────────────────────────────────
	md = stripTags(md);

	// ── Unescape HTML entities ───────────────────────────────────────────────
	md = unescapeHtml(md);

	// ── Clean up excess blank lines (max 2 consecutive) ─────────────────────
	md = md.replace(/\n{3,}/g, '\n\n');

	return md.trim();
}

/**
 * Remove all HTML tags from a string.
 */
function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, '');
}

/**
 * Decode common HTML entities.
 */
function unescapeHtml(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&mdash;/g, '—')
		.replace(/&ndash;/g, '–')
		.replace(/&hellip;/g, '…')
		.replace(/&ldquo;/g, '"')
		.replace(/&rdquo;/g, '"')
		.replace(/&lsquo;/g, "'")
		.replace(/&rsquo;/g, "'");
}
