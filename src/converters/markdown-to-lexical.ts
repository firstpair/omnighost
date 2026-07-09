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
}

interface LexicalDocument {
	root: LexicalNode;
}

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
		if (line.match(/^[*\-+]\s+/)) {
			const listItems: string[] = [];
			while (i < lines.length && lines[i].match(/^[*\-+]\s+/)) {
				listItems.push(lines[i].replace(/^[*\-+]\s+/, ''));
				i++;
			}
			nodes.push(createUnorderedList(listItems));
			continue;
		}

		// Ordered list
		if (line.match(/^\d+\.\s+/)) {
			const listItems: string[] = [];
			while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
				listItems.push(lines[i].replace(/^\d+\.\s+/, ''));
				i++;
			}
			nodes.push(createOrderedList(listItems));
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
		while (i < lines.length && !isBlockStart(lines[i])) {
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

function isBlockStart(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed === '') return true;
	if (trimmed === '--members-only--') return true;
	if (/^(#{1,6})\s+(.+)$/.test(line)) return true;
	if (/^[*\-+]\s+/.test(line)) return true;
	if (/^\d+\.\s+/.test(line)) return true;
	if (line.startsWith('```')) return true;
	if (line.startsWith('>')) return true;
	if (/^!\[([^\]]*)\]\(([^)]+)\)\s*$/.test(line)) return true;
	return false;
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

	// Replace [text](url)
	current = current.replace(/\[(.+?)\]\((.+?)\)/g, (_, text, url) => {
		return `{{LINK:${url}}}${text}{{/LINK}}`;
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
		} else if (segment.startsWith('{{LINK:')) {
			const url = segment.match(/\{\{LINK:(.+?)\}\}/)?.[1] || '';
			i++;
			nodes.push({
				type: 'link',
				url,
				rel: null,
				target: null,
				title: null,
				version: 1,
				children: [{
					type: 'extended-text',
					text: segments[i],
					version: 1,
					format: 0,
					detail: 0,
					mode: 'normal',
					style: ''
				}],
				direction: 'ltr'
			});
			i += 2; // Skip {{/LINK}}
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
