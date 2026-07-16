import { GhostWriterSettings } from './types';

/**
 * Generate Ghost frontmatter properties
 */
export function generateGhostFrontmatter(settings: GhostWriterSettings): string {
	const prefix = settings.yamlPrefix;

	return `---
${prefix}post_access: public
${prefix}published: false
${prefix}published_at: ""
${prefix}featured: false
${prefix}tags: []
${prefix}excerpt: ""
${prefix}feature_image: ""
${prefix}cover_from_first_image: false
${prefix}no_sync: false
---

`;
}

/**
 * Generate a complete new Ghost post template
 */
export function generateNewPostTemplate(settings: GhostWriterSettings, title?: string): string {
	const postTitle = title || 'Untitled Post';
	const frontmatter = generateGhostFrontmatter(settings);

	return `${frontmatter}# ${postTitle}

Write your public preview here...

--members-only--

Write your members-only content here...
`;
}

/**
 * Check if a note already has Ghost properties (with any prefix)
 */
export function hasGhostProperties(content: string, prefix: string): boolean {
	// Escape special regex characters in prefix
	const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const ghostPropertyPattern = new RegExp(`^${escapedPrefix}(post_access|published|published_at|featured|tags|excerpt|feature_image|cover_from_first_image|no_sync|id|slug):`, 'm');
	return ghostPropertyPattern.test(content);
}

/**
 * Find all Ghost properties in content (with any prefix)
 * Returns the prefixes found
 */
export function findGhostPropertyPrefixes(content: string): string[] {
	const prefixes = new Set<string>();
	const ghostKeys = ['post_access', 'published', 'published_at', 'featured', 'tags', 'excerpt', 'feature_image', 'cover_from_first_image', 'no_sync', 'id', 'slug'];
	const lines = content.split('\n');

	for (const line of lines) {
		for (const key of ghostKeys) {
			// Match pattern: any_prefix + key + :
			const match = line.match(new RegExp(`^(.+?)${key}:\\s*`));
			if (match) {
				prefixes.add(match[1]);
			}
		}
	}

	return Array.from(prefixes);
}

/**
 * Parse existing frontmatter from content
 */
export function extractFrontmatter(content: string): { frontmatter: string; body: string } | null {
	const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);

	if (match) {
		return {
			frontmatter: match[1],
			body: match[2]
		};
	}

	return null;
}

/**
 * Remove Ghost properties with old prefixes from frontmatter
 */
export function removeOldGhostProperties(frontmatter: string, currentPrefix: string): string {
	const ghostKeys = ['post_access', 'published', 'published_at', 'featured', 'tags', 'excerpt', 'feature_image', 'cover_from_first_image', 'no_sync', 'id', 'slug'];
	const lines = frontmatter.split('\n');
	const filteredLines: string[] = [];

	for (const line of lines) {
		let isOldGhostProperty = false;

		// Check if this line is a Ghost property with a different prefix
		for (const key of ghostKeys) {
			// Match any prefix + key
			const match = line.match(new RegExp(`^(.+?)${key}:\\s*`));
			if (match) {
				const linePrefix = match[1];
				// If prefix is different from current, skip this line
				if (linePrefix !== currentPrefix) {
					isOldGhostProperty = true;
					console.debug(`[Ghost] Removing old property: ${line.trim()} (old prefix: "${linePrefix}", new prefix: "${currentPrefix}")`);
					break;
				}
			}
		}

		if (!isOldGhostProperty) {
			filteredLines.push(line);
		}
	}

	return filteredLines.join('\n');
}

/**
 * Get list of missing Ghost properties
 */
function getMissingGhostProperties(frontmatter: string, prefix: string): string[] {
	const allGhostKeys = ['post_access', 'published', 'published_at', 'featured', 'tags', 'excerpt', 'feature_image', 'cover_from_first_image', 'no_sync'];
	const lines = frontmatter.split('\n');
	const existingKeys = new Set<string>();

	for (const line of lines) {
		for (const key of allGhostKeys) {
			if (line.match(new RegExp(`^${prefix}${key}:`))) {
				existingKeys.add(key);
			}
		}
	}

	return allGhostKeys.filter(key => !existingKeys.has(key));
}

/**
 * Add Ghost properties to existing content
 * If old Ghost properties exist with different prefix, they will be removed
 * Only adds missing properties if some already exist
 */
export function addGhostPropertiesToContent(content: string, settings: GhostWriterSettings): string {
	const prefix = settings.yamlPrefix;

	// Check if content already has frontmatter
	const parsed = extractFrontmatter(content);

	if (parsed) {
		// Find if there are old Ghost properties with different prefix
		const oldPrefixes = findGhostPropertyPrefixes(content);
		const hasOldProperties = oldPrefixes.length > 0 && !oldPrefixes.includes(prefix);

		// Remove old Ghost properties if they exist
		let cleanedFrontmatter = parsed.frontmatter;
		if (hasOldProperties) {
			cleanedFrontmatter = removeOldGhostProperties(parsed.frontmatter, prefix);
		}

		// Check which properties are missing
		const missingProps = getMissingGhostProperties(cleanedFrontmatter, prefix);

		if (missingProps.length === 0) {
			return content; // All properties already exist
		}

		// Build only the missing properties
		const propsToAdd: string[] = [];
		const defaults: Record<string, string> = {
			'post_access': 'public',
			'published': 'false',
			'published_at': '""',
			'featured': 'false',
			'tags': '[]',
			'excerpt': '""',
			'feature_image': '""',
			'cover_from_first_image': 'false',
			'no_sync': 'false'
		};

		for (const key of missingProps) {
			propsToAdd.push(`${prefix}${key}: ${defaults[key]}`);
		}

		// Add to existing frontmatter
		return `---
${cleanedFrontmatter}
${propsToAdd.join('\n')}
---
${parsed.body}`;
	} else {
		// Create new frontmatter with all properties
		const ghostProperties = `${prefix}post_access: public
${prefix}published: false
${prefix}published_at: ""
${prefix}featured: false
${prefix}tags: []
${prefix}excerpt: ""
${prefix}feature_image: ""
${prefix}cover_from_first_image: false
${prefix}no_sync: false`;

		return `---
${ghostProperties}
---

${content}`;
	}
}
