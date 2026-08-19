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

	// ── Tables ──────────────────────────────────────────────────────────────
	// Omnighost publishes Markdown tables as Ghost HTML cards because Lexical
	// has no native table node. Reconstruct Markdown before the generic inline
	// and tag passes so importing the post remains lossless.
	md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (table: string, inner: string) =>
		tableHtmlToMarkdown(inner) ?? table
	);

	// ── Lists ───────────────────────────────────────────────────────────────
	// Unordered
	md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner: string) => {
		return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) =>
			`- ${listItemToMarkdown(item)}\n`
		) + '\n';
	});

	// Ordered
	md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
		let index = 1;
		return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) =>
			`${index++}. ${listItemToMarkdown(item)}\n`
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
 * Normalize Ghost list item HTML before the generic inline conversion pass.
 *
 * Ghost commonly wraps list item content in paragraph tags. If those tags are
 * stripped before list items are separated, adjacent items collapse together
 * during import. Keep inline tags intact so the later inline-formatting pass
 * can still turn links/emphasis/code into Markdown.
 */
function listItemToMarkdown(html: string): string {
	return html
		.replace(/<\/p>\s*<p[^>]*>/gi, ' ')
		.replace(/<\/?p[^>]*>/gi, '')
		.replace(/<br[^>]*\/?>/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tableHtmlToMarkdown(html: string): string | null {
	const rows = Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
	if (rows.length === 0) return null;

	const parsedRows = rows.map(row => Array.from(
		row[1].matchAll(/<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi)
	).map(cell => ({
		header: cell[1].toLowerCase() === 'th',
		attributes: cell[2],
		content: tableCellToMarkdown(cell[3])
	})));
	const headerIndex = parsedRows.findIndex(row => row.some(cell => cell.header));
	const effectiveHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
	const header = parsedRows[effectiveHeaderIndex];
	if (!header || header.length === 0) return null;

	const delimiter = header.map(cell => tableMarkdownDelimiter(cell.attributes));
	const body = parsedRows.filter((_, index) => index !== effectiveHeaderIndex);
	const renderRow = (cells: Array<{ content: string }>) =>
		`| ${header.map((_, index) => cells[index]?.content ?? '').join(' | ')} |`;

	return [
		renderRow(header),
		`| ${delimiter.join(' | ')} |`,
		...body.map(renderRow)
	].join('\n') + '\n\n';
}

function tableCellToMarkdown(html: string): string {
	return html
		.replace(/<br[^>]*\/?>/gi, ' ')
		.replace(/<\/?p[^>]*>/gi, '')
		.replace(/\|/g, '\\|')
		.replace(/\s+/g, ' ')
		.trim();
}

function tableMarkdownDelimiter(attributes: string): string {
	const alignment = attributes.match(/(?:text-align\s*:\s*|align=["']?)(left|center|right)/i)?.[1]?.toLowerCase();
	if (alignment === 'left') return ':---';
	if (alignment === 'center') return ':---:';
	if (alignment === 'right') return '---:';
	return '---';
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
		.replace(/&#39;|&#039;|&#x27;|&apos;/gi, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&mdash;/g, '—')
		.replace(/&ndash;/g, '–')
		.replace(/&hellip;/g, '…')
		.replace(/&ldquo;/g, '"')
		.replace(/&rdquo;/g, '"')
		.replace(/&lsquo;/g, "'")
		.replace(/&rsquo;/g, "'");
}
