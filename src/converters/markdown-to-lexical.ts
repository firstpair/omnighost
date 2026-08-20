/**
 * Convert Markdown to Ghost's Lexical format
 * Lexical is a JSON-based editor format used by Ghost
 */

interface LexicalNode {
	type: string;
	version?: number;
	format?: string | number;
	indent?: number;
	direction?: string | null;
	children?: LexicalNode[];
	text?: string;
	mode?: string;
	detail?: number;
	style?: string;
	tag?: string;
	url?: string;
	rel?: string | null;
	target?: string | null;
	title?: string | null;
	listType?: string;
	start?: number;
	value?: number;
	// Image fields
	src?: string;
	alt?: string;
	width?: number | null;
	height?: number | null;
	// Code block card fields
	code?: string;
	language?: string;
	caption?: string;
	// Paywall card fields
	paywall?: boolean;
	// HTML card fields
	html?: string;
}

interface LexicalDocument {
	root: LexicalNode;
}

const UNORDERED_LIST_ITEM_PATTERN = /^[*\-+]\s+(.*)$/;
const ORDERED_LIST_ITEM_PATTERN = /^\d+\.\s+(.*)$/;

/**
 * Convert markdown to Lexical format
 * Skips the first H1 heading (as it's used for the title field)
 */
export function markdownToLexical(markdown: string): string {
	const nodes: LexicalNode[] = [];
	const lines = markdown.split('\n');

	let i = 0;
	let skippedFirstH1 = false;

	while (i < lines.length) {
		const line = lines[i];

		// Skip empty lines
		if (line.trim() === '') {
			i++;
			continue;
		}

		// Members-only paywall marker
		if (line.trim() === '--members-only--') {
			nodes.push(createPaywall());
			i++;
			continue;
		}

		// GitHub-flavoured Markdown table. Ghost Lexical has no native table
		// node, so preserve the structure in an HTML card instead of flattening
		// the pipe-delimited source into a paragraph.
		const table = parseMarkdownTable(lines, i);
		if (table) {
			nodes.push(createTable(table));
			i = table.nextLine;
			continue;
		}

		// Heading
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			const level = headingMatch[1].length;
			const text = headingMatch[2];

			// Skip the first H1 (it's the title)
			if (level === 1 && !skippedFirstH1) {
				skippedFirstH1 = true;
				i++;
				continue;
			}

			nodes.push(createHeading(text, level));
			i++;
			continue;
		}

		// Unordered list
		if (UNORDERED_LIST_ITEM_PATTERN.test(line)) {
			const list = parseListItems(lines, i, UNORDERED_LIST_ITEM_PATTERN);
			nodes.push(createUnorderedList(list.items));
			i = list.nextLine;
			continue;
		}

		// Ordered list
		if (ORDERED_LIST_ITEM_PATTERN.test(line)) {
			const list = parseListItems(lines, i, ORDERED_LIST_ITEM_PATTERN);
			nodes.push(createOrderedList(list.items));
			i = list.nextLine;
			continue;
		}

		// Code block
		if (line.startsWith('```')) {
			// Extract language from opening fence (e.g., ```javascript)
			const language = line.slice(3).trim();
			const codeLines: string[] = [];
			i++; // Skip opening ```
			while (i < lines.length && lines[i].trimEnd() !== '```') {
				codeLines.push(lines[i]);
				i++;
			}
			// Only skip closing ``` if we found it (not end of file)
			if (i < lines.length) {
				i++; // Skip closing ```
			}
			nodes.push(createCodeBlock(codeLines.join('\n'), language));
			continue;
		}

		// Quote
		if (line.startsWith('>')) {
			const quoteParagraphs: string[][] = [];
			let quoteLines: string[] = [];
			while (i < lines.length && lines[i].startsWith('>')) {
				const quoteLine = lines[i].replace(/^>\s?/, '');
				if (quoteLine.trim() === '') {
					if (quoteLines.length > 0) {
						quoteParagraphs.push(quoteLines);
						quoteLines = [];
					}
				} else {
					quoteLines.push(quoteLine);
				}
				i++;
			}
			if (quoteLines.length > 0) {
				quoteParagraphs.push(quoteLines);
			}
			nodes.push(createQuote(quoteParagraphs.map(joinParagraphLines)));
			continue;
		}

		// Image (standalone on its own line)
		const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
		if (imageMatch) {
			const alt = imageMatch[1] || '';
			const src = imageMatch[2];
			nodes.push(createImage(src, alt));
			i++;
			continue;
		}

		// Regular paragraph
		const paragraphLines: string[] = [];
		while (i < lines.length && !isBlockStart(lines[i], lines[i + 1])) {
			paragraphLines.push(lines[i]);
			i++;
		}
		nodes.push(createParagraph(joinParagraphLines(paragraphLines)));
	}

	// Ghost rejects a lexical document with no children, so an empty note would
	// fail to publish. Ensure there is always at least one (empty) paragraph.
	if (nodes.length === 0) {
		nodes.push(createParagraph(''));
	}

	const lexical: LexicalDocument = {
		root: {
			type: 'root',
			format: '',
			indent: 0,
			version: 1,
			children: nodes,
			direction: 'ltr'
		}
	};

	return JSON.stringify(lexical);
}

function isBlockStart(line: string, nextLine?: string): boolean {
	if (isStandaloneBlockStart(line)) return true;
	if (nextLine !== undefined && isTableHeader(line, nextLine)) return true;
	return false;
}

interface ParsedListItems {
	items: string[];
	nextLine: number;
}

/**
 * Parse consecutive list items and their wrapped paragraph continuations.
 * CommonMark permits both content-indented lines and unindented lazy lines;
 * either form belongs to the current item until a blank or new block begins.
 */
function parseListItems(lines: string[], start: number, itemPattern: RegExp): ParsedListItems {
	const items: string[] = [];
	let nextLine = start;

	while (nextLine < lines.length) {
		const item = lines[nextLine].match(itemPattern);
		if (!item) break;

		const itemLines = [item[1]];
		nextLine++;
		while (nextLine < lines.length && !isBlockStart(lines[nextLine], lines[nextLine + 1])) {
			itemLines.push(lines[nextLine]);
			nextLine++;
		}
		items.push(joinParagraphLines(itemLines));
	}

	return { items, nextLine };
}

/** Block forms which interrupt a table as well as an ordinary paragraph. */
function isStandaloneBlockStart(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed === '') return true;
	if (trimmed === '--members-only--') return true;
	if (/^(#{1,6})\s+(.+)$/.test(line)) return true;
	if (UNORDERED_LIST_ITEM_PATTERN.test(line)) return true;
	if (ORDERED_LIST_ITEM_PATTERN.test(line)) return true;
	if (line.startsWith('```')) return true;
	if (line.startsWith('>')) return true;
	if (/^!\[([^\]]*)\]\(([^)]+)\)\s*$/.test(line)) return true;
	return false;
}

type TableAlignment = 'left' | 'center' | 'right' | null;
type TableCellKind = 'header' | 'body';

const TABLE_STYLE = 'width:100%;min-width:640px;border-collapse:collapse;border-spacing:0';
const TABLE_HEADER_CELL_STYLE = 'padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap';
const TABLE_BODY_CELL_STYLE = 'padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top';
const TABLE_COMPACT_CELL_STYLE = 'white-space:nowrap';

interface MarkdownTable {
	headers: string[];
	alignments: TableAlignment[];
	rows: string[][];
	nextLine: number;
}

function parseMarkdownTable(lines: string[], start: number): MarkdownTable | null {
	const header = lines[start];
	const delimiter = lines[start + 1];
	if (delimiter === undefined || !isTableHeader(header, delimiter)) return null;

	const headers = splitTableRow(header);
	const delimiterCells = splitTableRow(delimiter);
	const alignments = delimiterCells.map(parseTableAlignment);
	const rows: string[][] = [];
	let nextLine = start + 2;

	while (nextLine < lines.length) {
		const line = lines[nextLine];
		// GFM tables end when another block begins. Without this check, a heading,
		// list item, quote, or fence containing a pipe is silently consumed as a
		// table row and disappears from the rendered document structure.
		if (isStandaloneBlockStart(line) || !hasUnescapedPipe(line)) break;
		const cells = splitTableRow(line).slice(0, headers.length);
		while (cells.length < headers.length) cells.push('');
		rows.push(cells);
		nextLine++;
	}

	return { headers, alignments, rows, nextLine };
}

function isTableHeader(header: string, delimiter: string): boolean {
	if (!hasUnescapedPipe(header) || !hasUnescapedPipe(delimiter)) return false;
	const headers = splitTableRow(header);
	const delimiters = splitTableRow(delimiter);
	return headers.length > 0
		&& headers.length === delimiters.length
		&& delimiters.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
}

function hasUnescapedPipe(line: string): boolean {
	let escaped = false;
	for (const character of line) {
		if (character === '|' && !escaped) return true;
		escaped = character === '\\' && !escaped;
		if (character !== '\\') escaped = false;
	}
	return false;
}

function splitTableRow(line: string): string[] {
	const trimmed = line.trim();
	let withoutOuterPipes = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
	if (withoutOuterPipes.endsWith('|') && !endsWithEscapedCharacter(withoutOuterPipes, '|')) {
		withoutOuterPipes = withoutOuterPipes.slice(0, -1);
	}
	const cells: string[] = [];
	let cell = '';
	let escaped = false;

	for (const character of withoutOuterPipes) {
		if (escaped) {
			cell += character === '|' ? '|' : `\\${character}`;
			escaped = false;
		} else if (character === '\\') {
			escaped = true;
		} else if (character === '|') {
			cells.push(cell.trim());
			cell = '';
		} else {
			cell += character;
		}
	}
	if (escaped) cell += '\\';
	cells.push(cell.trim());
	return cells;
}

function endsWithEscapedCharacter(value: string, character: string): boolean {
	if (!value.endsWith(character)) return false;
	let backslashes = 0;
	for (let index = value.length - 2; index >= 0 && value[index] === '\\'; index--) {
		backslashes++;
	}
	return backslashes % 2 === 1;
}

function parseTableAlignment(delimiter: string): TableAlignment {
	const value = delimiter.trim();
	if (value.startsWith(':') && value.endsWith(':')) return 'center';
	if (value.endsWith(':')) return 'right';
	if (value.startsWith(':')) return 'left';
	return null;
}

function createTable(table: MarkdownTable): LexicalNode {
	const header = table.headers.map((cell, index) =>
		`<th${tableCellStyleAttribute('header', table.alignments[index])}>${inlineMarkdownToHtml(cell)}</th>`
	).join('');
	const body = table.rows.map(row => `<tr>${row.map((cell, index) =>
		`<td${tableCellStyleAttribute('body', table.alignments[index], isCompactTableCell(cell))}>${inlineMarkdownToHtml(cell)}</td>`
	).join('')}</tr>`).join('');

	return {
		type: 'html',
		version: 1,
		html: `<div class="omnighost-table" style="max-width:100%;overflow-x:auto"><table style="${TABLE_STYLE}"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`
	};
}

function tableCellStyleAttribute(kind: TableCellKind, alignment: TableAlignment | undefined, compact = false): string {
	const baseStyle = kind === 'header' ? TABLE_HEADER_CELL_STYLE : TABLE_BODY_CELL_STYLE;
	const safeAlignment = alignment ?? 'left';
	const compactStyle = kind === 'body' && compact ? `;${TABLE_COMPACT_CELL_STYLE}` : '';
	return ` style="${baseStyle};text-align:${safeAlignment}${compactStyle}"`;
}

/** Keep short identifiers and measurements together while allowing prose to wrap. */
function isCompactTableCell(markdown: string): boolean {
	const unformatted = markdown.replace(/[*_`~]/g, '').trim();
	return unformatted.length > 0 && unformatted.length <= 24 && !/\s/.test(unformatted);
}

function inlineMarkdownToHtml(markdown: string): string {
	return parseInlineFormatting(markdown).map(inlineLexicalNodeToHtml).join('');
}

function inlineLexicalNodeToHtml(node: LexicalNode): string {
	if (node.type === 'link') {
		const label = (node.children ?? []).map(inlineLexicalNodeToHtml).join('');
		return `<a href="${escapeHtmlAttribute(safeTableHref(node.url ?? ''))}">${label}</a>`;
	}

	const text = escapeHtml(node.text ?? '');
	if (node.format === 1) return `<strong>${text}</strong>`;
	if (node.format === 2) return `<em>${text}</em>`;
	if (node.format === 16) return `<code>${text}</code>`;
	return text;
}

function safeTableHref(value: string): string {
	const trimmed = value.trim();
	if (/^(?:https?:|mailto:)/i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#')) {
		return trimmed;
	}
	return '#';
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value).replace(/`/g, '&#96;');
}

function joinParagraphLines(lines: string[]): string {
	return lines.map((paragraphLine) => paragraphLine.trim()).join(' ');
}

/**
 * Create a heading node
 */
function createHeading(text: string, level: number): LexicalNode {
	return {
		type: 'heading',
		tag: `h${level}`,
		version: 1,
		children: parseInlineFormatting(text),
		direction: 'ltr',
		format: '',
		indent: 0
	};
}

/**
 * Create a paragraph node
 */
function createParagraph(text: string): LexicalNode {
	return {
		type: 'paragraph',
		version: 1,
		children: parseInlineFormatting(text),
		direction: 'ltr',
		format: '',
		indent: 0
	};
}

/**
 * Create an unordered list node
 */
function createUnorderedList(items: string[]): LexicalNode {
	return {
		type: 'list',
		listType: 'bullet',
		tag: 'ul',
		version: 1,
		children: items.map(item => ({
			type: 'listitem',
			version: 1,
			value: 1,
			children: [{
				type: 'paragraph',
				version: 1,
				children: parseInlineFormatting(item),
				direction: 'ltr',
				format: '',
				indent: 0
			}],
			direction: 'ltr',
			format: '',
			indent: 0
		})),
		direction: 'ltr',
		format: '',
		indent: 0
	};
}

/**
 * Create an ordered list node
 */
function createOrderedList(items: string[]): LexicalNode {
	return {
		type: 'list',
		listType: 'number',
		tag: 'ol',
		start: 1,
		version: 1,
		children: items.map((item, index) => ({
			type: 'listitem',
			version: 1,
			value: index + 1,
			children: [{
				type: 'paragraph',
				version: 1,
				children: parseInlineFormatting(item),
				direction: 'ltr',
				format: '',
				indent: 0
			}],
			direction: 'ltr',
			format: '',
			indent: 0
		})),
		direction: 'ltr',
		format: '',
		indent: 0
	};
}

/**
 * Create a code block node using Ghost's codeblock card format
 */
function createCodeBlock(code: string, language: string): LexicalNode {
	return {
		type: 'codeblock',
		version: 1,
		code,
		language: language || '',
		caption: ''
	};
}

/**
 * Create a quote node
 */
function createQuote(paragraphs: string[]): LexicalNode {
	const quoteParagraphs = paragraphs.length > 0 ? paragraphs : [''];

	return {
		type: 'quote',
		version: 1,
		children: quoteParagraphs.map((text) => ({
			type: 'paragraph',
			version: 1,
			children: parseInlineFormatting(text),
			direction: 'ltr',
			format: '',
			indent: 0
		})),
		direction: 'ltr',
		format: '',
		indent: 0
	};
}

/**
 * Create an image node
 */
function createImage(src: string, alt: string): LexicalNode {
	return {
		type: 'image',
		version: 1,
		src,
		alt,
		width: null,
		height: null,
		title: null,
		format: '',
		indent: 0,
		direction: null
	};
}

/**
 * Create a paywall (members-only) node
 */
function createPaywall(): LexicalNode {
	return {
		type: 'paywall',
		version: 1
	};
}

/**
 * Parse inline formatting (bold, italic, code, links)
 */
function parseInlineFormatting(text: string): LexicalNode[] {
	const nodes: LexicalNode[] = [];
	let linkEnd = 0;
	let linkMatch: InlineMarkdownLink | null;

	// Links must be isolated before parsing emphasis. URLs are opaque data, not
	// Markdown prose: a valid URL such as a YouTube id containing `_t_` must not
	// be interpreted as italic markup. Formatting still applies to link labels.
	while ((linkMatch = findNextInlineMarkdownLink(text, linkEnd)) !== null) {
		if (linkMatch.start > linkEnd) {
			nodes.push(...parseInlineText(text.slice(linkEnd, linkMatch.start)));
		}

		nodes.push({
			type: 'link',
			url: linkMatch.url,
			rel: null,
			target: null,
			title: null,
			version: 1,
			children: parseInlineText(linkMatch.label),
			direction: 'ltr'
		});
		linkEnd = linkMatch.end;
	}

	if (linkEnd < text.length) {
		nodes.push(...parseInlineText(text.slice(linkEnd)));
	}

	if (nodes.length === 0) {
		return parseInlineText(text);
	}

	return nodes;
}

interface InlineMarkdownLink {
	start: number;
	end: number;
	label: string;
	url: string;
}

/** Find a Markdown inline link while consuming balanced URL parentheses. */
function findNextInlineMarkdownLink(text: string, fromIndex: number): InlineMarkdownLink | null {
	let labelStart = text.indexOf('[', fromIndex);

	while (labelStart >= 0) {
		const labelEnd = text.indexOf('](', labelStart + 1);
		if (labelEnd < 0) return null;

		const destinationStart = labelEnd + 2;
		let depth = 1;
		for (let index = destinationStart; index < text.length; index++) {
			if (text[index] === '\\') {
				index++;
				continue;
			}
			if (text[index] === '(') {
				depth++;
				continue;
			}
			if (text[index] !== ')') continue;

			depth--;
			if (depth === 0 && index > destinationStart) {
				return {
					start: labelStart,
					end: index + 1,
					label: text.slice(labelStart + 1, labelEnd),
					url: text.slice(destinationStart, index)
				};
			}
		}

		labelStart = text.indexOf('[', labelStart + 1);
	}

	return null;
}

/** Parse formatting in ordinary text after links and their URLs are isolated. */
function parseInlineText(text: string): LexicalNode[] {
	const nodes: LexicalNode[] = [];
	let current = text;

	// Simple parser for inline formatting
	// This is a basic implementation - can be enhanced later

	// Replace **bold** and __bold__
	current = current.replace(/\*\*(.+?)\*\*/g, (_, content) => {
		return `{{BOLD}}${content}{{/BOLD}}`;
	});
	current = current.replace(/__(.+?)__/g, (_, content) => {
		return `{{BOLD}}${content}{{/BOLD}}`;
	});

	// Replace *italic* and _italic_
	current = current.replace(/\*(.+?)\*/g, (_, content) => {
		return `{{ITALIC}}${content}{{/ITALIC}}`;
	});
	current = current.replace(/_(.+?)_/g, (_, content) => {
		return `{{ITALIC}}${content}{{/ITALIC}}`;
	});

	// Replace `code`
	current = current.replace(/`(.+?)`/g, (_, content) => {
		return `{{CODE}}${content}{{/CODE}}`;
	});

	// Parse the marked-up text
	const segments = current.split(/(\{\{[^}]+\}\})/g);

	let i = 0;
	while (i < segments.length) {
		const segment = segments[i];

		if (segment.startsWith('{{BOLD}}')) {
			i++;
			nodes.push({
				type: 'extended-text',
				text: segments[i],
				version: 1,
				format: 1, // Bold
				detail: 0,
				mode: 'normal',
				style: ''
			});
			i += 2; // Skip {{/BOLD}}
		} else if (segment.startsWith('{{ITALIC}}')) {
			i++;
			nodes.push({
				type: 'extended-text',
				text: segments[i],
				version: 1,
				format: 2, // Italic
				detail: 0,
				mode: 'normal',
				style: ''
			});
			i += 2; // Skip {{/ITALIC}}
		} else if (segment.startsWith('{{CODE}}')) {
			i++;
			nodes.push({
				type: 'extended-text',
				text: segments[i],
				version: 1,
				format: 16, // Code
				detail: 0,
				mode: 'normal',
				style: ''
			});
			i += 2; // Skip {{/CODE}}
		} else if (segment && !segment.startsWith('{{')) {
			// Regular text
			nodes.push({
				type: 'extended-text',
				text: segment,
				version: 1,
				format: 0,
				detail: 0,
				mode: 'normal',
				style: ''
			});
			i++;
		} else {
			i++;
		}
	}

	// If no nodes were created, add a simple text node
	if (nodes.length === 0) {
		nodes.push({
			type: 'extended-text',
			text: text,
			version: 1,
			format: 0,
			detail: 0,
			mode: 'normal',
			style: ''
		});
	}

	return nodes;
}
