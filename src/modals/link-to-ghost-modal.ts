import { App, Modal, Setting, TFile, Notice } from 'obsidian';
import { GhostAPIClient } from '../ghost/api-client';
import { GhostBlog, GhostPost, GhostWriterSettings } from '../types';
import { extractPostIdFromUrl, buildGhostEditorUrl } from './import-from-ghost-modal';

type LinkSource = 'ghost' | 'obsidian';

interface LinkResult {
	ghostPost: GhostPost;
	obsidianFile: TFile;
	source: LinkSource;
	ghostUrl: string;
	blog: GhostBlog | null;
}

type OnLinkCallback = (result: LinkResult) => Promise<void>;

interface BlogAwareHost {
	blogForUrl(url: string): GhostBlog | null;
	getClientForBlog(blog: GhostBlog): GhostAPIClient;
}

/**
 * Modal for linking an existing Ghost post to an existing Obsidian note
 */
export class LinkToGhostModal extends Modal {
	private ghostClient: GhostAPIClient;
	private settings: GhostWriterSettings;
	private onLink: OnLinkCallback;
	private plugin?: BlogAwareHost;

	private source: LinkSource = 'ghost';
	private ghostUrlInput = '';
	private obsidianNoteInput = '';

	// DOM references for dynamic re-rendering
	private fieldsContainer: HTMLElement | null = null;
	private autocompleteContainer: HTMLElement | null = null;
	private allNoteNames: string[] = [];
	private selectedFile: TFile | null = null;

	constructor(
		app: App,
		ghostClient: GhostAPIClient,
		settings: GhostWriterSettings,
		onLink: OnLinkCallback,
		plugin?: BlogAwareHost
	) {
		super(app);
		this.ghostClient = ghostClient;
		this.settings = settings;
		this.onLink = onLink;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		this.titleEl.setText('Link note to ghost post');

		// Load all vault markdown file names for autocomplete
		this.allNoteNames = this.app.vault
			.getMarkdownFiles()
			.map(f => f.basename)
			.sort((a, b) => a.localeCompare(b));

		// Description paragraph
		contentEl.createEl('p', {
			text: 'Relate existing content between ghost and Obsidian.',
			cls: 'ghost-modal-description'
		});

		// Source selector
		new Setting(contentEl)
			.setName('Primary source')
			.setDesc('The primary source will overwrite the destination.')
			.addDropdown(drop => {
				drop
					.addOption('ghost', 'Ghost')
					.addOption('obsidian', 'Obsidian')
					.setValue(this.source)
					.onChange(value => {
						this.source = value as LinkSource;
						this.renderFields();
					});
				drop.selectEl.setAttribute('aria-label', 'Select primary source');
			});

		// Container for the two dynamic fields
		this.fieldsContainer = contentEl.createDiv({ cls: 'ghost-link-fields' });
		this.renderFields();

		// Warning message
		const warning = contentEl.createEl('p', {
			cls: 'ghost-modal-warning'
		});
		warning.createEl('strong', { text: 'Caution: ' });
		warning.appendText('The primary source will completely overwrite the content of the destination.');

		// Buttons
		const buttonSetting = new Setting(contentEl)
			.addButton(btn => {
				btn
					.setButtonText('Continue')
					.setCta()
					.onClick(() => { void this.handleLink(); });
				btn.buttonEl.setAttribute('aria-label', 'Continue and link');
			})
			.addButton(btn => {
				btn
					.setButtonText('Cancel')
					.onClick(() => { this.close(); });
				btn.buttonEl.setAttribute('aria-label', 'Cancel');
			});

		buttonSetting.settingEl.addClass('ghost-modal-button-row');
	}

	private renderFields(): void {
		if (!this.fieldsContainer) return;

		this.fieldsContainer.empty();
		this.autocompleteContainer = null;
		this.selectedFile = null;

		if (this.source === 'ghost') {
			this.renderGhostField(this.fieldsContainer);
			this.renderObsidianField(this.fieldsContainer);
		} else {
			this.renderObsidianField(this.fieldsContainer);
			this.renderGhostField(this.fieldsContainer);
		}
	}

	private renderGhostField(container: HTMLElement): void {
		new Setting(container)
			.setName('Choose the post in ghost')
			.setDesc('Paste the ghost editor URL (e.g., https://yourblog.com/ghost/#/editor/post/...)')
			.addText(text => {
				text
					.setPlaceholder('https://yourblog.com/ghost/#/editor/post/...')
					.setValue(this.ghostUrlInput)
					.onChange(value => { this.ghostUrlInput = value.trim(); });

				text.inputEl.setAttribute('aria-label', 'Ghost editor URL');
				text.inputEl.addClass('ghost-modal-input-full-width');
			});
	}

	private renderObsidianField(container: HTMLElement): void {
		const fieldWrapper = container.createDiv({ cls: 'ghost-obsidian-field-wrapper' });

		new Setting(fieldWrapper)
			.setName('Choose the note in Obsidian')
			.setDesc('Type to search for a note in your vault.')
			.addText(text => {
				text
					.setPlaceholder('Note name...')
					.setValue(this.obsidianNoteInput)
					.onChange(value => {
						this.obsidianNoteInput = value;
						this.selectedFile = null;
						this.updateAutocomplete(value, fieldWrapper);
					});

				text.inputEl.setAttribute('aria-label', 'Obsidian note name');
				text.inputEl.addClass('ghost-modal-input-full-width');

				text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
					if (e.key === 'Escape' && this.autocompleteContainer) {
						this.autocompleteContainer.empty();
					}
				});
			});

		// Autocomplete dropdown container
		this.autocompleteContainer = fieldWrapper.createDiv({ cls: 'ghost-autocomplete' });
	}

	private updateAutocomplete(query: string, wrapper: HTMLElement): void {
		const container = this.autocompleteContainer;
		if (!container) return;

		container.empty();

		if (!query || query.length < 1) return;

		const lowerQuery = query.toLowerCase();
		const matches = this.allNoteNames
			.filter(name => name.toLowerCase().includes(lowerQuery))
			.slice(0, 8);

		if (matches.length === 0) return;

		const list = container.createEl('ul', { cls: 'ghost-autocomplete-list' });
		list.setAttribute('role', 'listbox');
		list.setAttribute('aria-label', 'Matching notes');

		for (const name of matches) {
			const item = list.createEl('li', {
				text: name,
				cls: 'ghost-autocomplete-item'
			});
			item.setAttribute('role', 'option');
			item.setAttribute('tabindex', '0');

			const selectItem = () => {
				this.obsidianNoteInput = name;
				this.selectedFile = this.app.vault.getMarkdownFiles()
					.find(f => f.basename === name) ?? null;

				// Update the input visually
				const input = wrapper.querySelector<HTMLInputElement>('input');
				if (input) input.value = name;

				container.empty();
			};

			item.addEventListener('click', selectItem);
			item.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					selectItem();
				}
			});
		}
	}

	private async handleLink(): Promise<void> {
		// Validate Ghost URL
		if (!this.ghostUrlInput) {
			new Notice('Please enter a ghost editor URL');
			return;
		}

		const postId = extractPostIdFromUrl(this.ghostUrlInput);
		if (!postId) {
			new Notice('Invalid ghost editor URL. Make sure it contains /editor/post/{id}');
			return;
		}

		// Validate Obsidian note
		const obsidianFile = this.selectedFile
			?? this.app.vault.getMarkdownFiles().find(f => f.basename === this.obsidianNoteInput)
			?? null;

		if (!obsidianFile) {
			new Notice('Note not found. Please select a valid note from the suggestions.');
			return;
		}

		const blog = this.plugin ? this.plugin.blogForUrl(this.ghostUrlInput) : null;
		const client = blog ? this.plugin?.getClientForBlog(blog) ?? this.ghostClient : this.ghostClient;
		const baseUrl = blog ? blog.url : this.settings.ghostUrl;
		const ghostUrl = buildGhostEditorUrl(baseUrl, postId);

		try {
			new Notice('Fetching post from ghost...');
			const post = await client.getPost(postId);
			this.close();
			await this.onLink({ ghostPost: post, obsidianFile, source: this.source, ghostUrl, blog });
		} catch (error) {
			new Notice(`Failed to fetch post: ${(error as Error).message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.autocompleteContainer = null;
		this.fieldsContainer = null;
	}
}
