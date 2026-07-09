import { App, Modal, Setting, Notice } from 'obsidian';
import { GhostAPIClient } from '../ghost/api-client';
import { GhostBlog, GhostPost, GhostWriterSettings } from '../types';
import { buildGhostEditorUrl } from '../ghost/url';

export { buildGhostEditorUrl };

/**
 * Extract Ghost post ID from an editor URL
 * Supports formats like:
 *   https://example.com/ghost/#/editor/post/6995c2b518d3e00001e1ca21
 *   https://example.com/ghost/#/editor/post/6995c2b518d3e00001e1ca21/
 */
export function extractPostIdFromUrl(url: string): string | null {
	const match = url.match(/\/editor\/post\/([a-f0-9]+)\/?$/i);
	return match ? match[1] : null;
}

interface BlogAwareHost {
	blogForUrl(url: string): GhostBlog | null;
	getClientForBlog(blog: GhostBlog): GhostAPIClient;
}

type OnImportCallback = (post: GhostPost, ghostUrl: string, blog: GhostBlog | null) => Promise<void>;

/**
 * Modal for importing an existing Ghost post as a new Obsidian note
 */
export class ImportFromGhostModal extends Modal {
	private ghostClient: GhostAPIClient;
	private settings: GhostWriterSettings;
	private onImport: OnImportCallback;
	private plugin?: BlogAwareHost;
	private urlInput = '';

	constructor(
		app: App,
		ghostClient: GhostAPIClient,
		settings: GhostWriterSettings,
		onImport: OnImportCallback,
		plugin?: BlogAwareHost
	) {
		super(app);
		this.ghostClient = ghostClient;
		this.settings = settings;
		this.onImport = onImport;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		this.titleEl.setText('Import post from ghost');

		contentEl.createEl('p', {
			text: 'Paste the ghost editor URL of the post you want to import.',
			cls: 'ghost-modal-description'
		});

		new Setting(contentEl)
			.setName('Ghost editor URL')
			.setDesc('Example: https://yourblog.com/ghost/#/editor/post/6995c2b518d3e00001e1ca21')
			.addText(text => {
				text
					.setPlaceholder('https://yourblog.com/ghost/#/editor/post/...')
					.onChange(value => { this.urlInput = value.trim(); });

				text.inputEl.setAttribute('aria-label', 'Ghost editor URL');
				text.inputEl.addClass('ghost-modal-input-full-width');

				// Allow submitting with Enter
				text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Enter') {
						void this.handleImport();
					}
				});
			});

		const buttonSetting = new Setting(contentEl)
			.addButton(btn => {
				btn
					.setButtonText('Import post')
					.setCta()
					.onClick(() => { void this.handleImport(); });
				btn.buttonEl.setAttribute('aria-label', 'Import post from ghost');
			})
			.addButton(btn => {
				btn
					.setButtonText('Cancel')
					.onClick(() => { this.close(); });
				btn.buttonEl.setAttribute('aria-label', 'Cancel import');
			});

		buttonSetting.settingEl.addClass('ghost-modal-button-row');
	}

	private async handleImport(): Promise<void> {
		if (!this.urlInput) {
			new Notice('Please enter a ghost editor URL');
			return;
		}

		const postId = extractPostIdFromUrl(this.urlInput);
		if (!postId) {
			new Notice('Invalid ghost editor URL. Make sure it contains /editor/post/{id}');
			return;
		}

		const blog = this.plugin ? this.plugin.blogForUrl(this.urlInput) : null;
		const client = blog ? this.plugin?.getClientForBlog(blog) ?? this.ghostClient : this.ghostClient;
		const baseUrl = blog ? blog.url : this.settings.ghostUrl;
		const ghostUrl = buildGhostEditorUrl(baseUrl, postId);

		try {
			new Notice('Fetching post from ghost...');
			const post = await client.getPost(postId);
			this.close();
			await this.onImport(post, ghostUrl, blog);
		} catch (error) {
			new Notice(`Failed to fetch post: ${(error as Error).message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
