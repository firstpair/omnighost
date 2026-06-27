import { App, Modal, Notice, Setting, setIcon } from 'obsidian';

/** Read-only context shown at the top of the modal (not editable). */
export interface GhostPropsInfo {
	savedStatus: 'draft' | 'publish' | 'schedule';
	publicUrl: string;
}

export interface GhostPropsForm {
	status: 'draft' | 'publish' | 'schedule';
	visibility: 'public' | 'members' | 'paid';
	featured: boolean;
	coverFromFirstImage: boolean;
	publishedAt: string;
	excerpt: string;
	tags: string; // comma-separated
	slug: string;
	featureImage: string;
}

/**
 * Modal to edit a note's Ghost properties with proper widgets — dropdowns for
 * the constrained fields (status, visibility) so invalid values are impossible,
 * free text only where it has to be (excerpt, tags, slug, feature image).
 * Non-sticky: it closes on Save.
 */
export class EditGhostPropertiesModal extends Modal {
	private title: string;
	private form: GhostPropsForm;
	private info: GhostPropsInfo;
	private onSubmit: (form: GhostPropsForm, doSync: boolean) => Promise<GhostPropsInfo | void>;
	private dateSetting?: Setting;
	private statusContainer?: HTMLElement;

	constructor(
		app: App,
		title: string,
		initial: GhostPropsForm,
		info: GhostPropsInfo,
		onSubmit: (form: GhostPropsForm, doSync: boolean) => Promise<GhostPropsInfo | void>
	) {
		super(app);
		this.title = title;
		this.form = { ...initial };
		this.info = info;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: `Ghost properties — ${this.title}` });

		// Status indicator + public URL (reflects the post's last-synced state).
		// Re-rendered in place after "Save & sync" so the live URL appears here
		// without having to reopen the modal.
		this.statusContainer = contentEl.createDiv();
		this.renderStatus();

		new Setting(contentEl)
			.setName('Status')
			.addDropdown(d => d
				.addOption('draft', 'Draft')
				.addOption('publish', 'Publish now')
				.addOption('schedule', 'Schedule')
				.setValue(this.form.status)
				.onChange(v => {
					this.form.status = v as GhostPropsForm['status'];
					this.updateDateVisibility();
				}));

		this.dateSetting = new Setting(contentEl)
			.setName('Publish date')
			.setDesc('Date used when scheduling, e.g. 2026-07-01 09:00')
			.addText(t => t
				.setPlaceholder('2026-07-01 09:00')
				.setValue(this.form.publishedAt)
				.onChange(v => this.form.publishedAt = v));

		new Setting(contentEl)
			.setName('Visibility')
			.addDropdown(d => d
				.addOption('public', 'Public')
				.addOption('members', 'Members only')
				.addOption('paid', 'Paid')
				.setValue(this.form.visibility)
				.onChange(v => this.form.visibility = v as GhostPropsForm['visibility']));

		new Setting(contentEl)
			.setName('Featured')
			.addToggle(t => t.setValue(this.form.featured).onChange(v => this.form.featured = v));

		new Setting(contentEl)
			.setName('Use first image as cover')
			.setDesc('Promote the first body image to the feature image and remove it from the body (ignored if a feature image is set)')
			.addToggle(t => t.setValue(this.form.coverFromFirstImage).onChange(v => this.form.coverFromFirstImage = v));

		new Setting(contentEl)
			.setName('Excerpt')
			.addText(t => t.setValue(this.form.excerpt).onChange(v => this.form.excerpt = v));

		new Setting(contentEl)
			.setName('Tags')
			.setDesc('Comma-separated')
			.addText(t => t.setValue(this.form.tags).onChange(v => this.form.tags = v));

		new Setting(contentEl)
			.setName('Slug')
			.setDesc('Leave empty to derive from the title')
			.addText(t => t.setValue(this.form.slug).onChange(v => this.form.slug = v));

		new Setting(contentEl)
			.setName('Feature image')
			.setDesc('URL')
			.addText(t => t.setValue(this.form.featureImage).onChange(v => this.form.featureImage = v));

		new Setting(contentEl)
			.addButton(b => b.setButtonText('Close').onClick(() => this.close()))
			.addButton(b => b.setButtonText('Save').onClick(() => void this.submit(false)))
			.addButton(b => b.setButtonText('Save & sync').setCta().onClick(() => void this.submit(true)));

		this.updateDateVisibility();
	}

	/** Render (or re-render) the status indicator and public URL row. */
	private renderStatus(): void {
		const c = this.statusContainer;
		if (!c) return;
		c.empty();

		const statusRow = c.createDiv({ cls: 'ghost-updater-status' });
		const iconEl = statusRow.createSpan({ cls: 'ghost-updater-status-icon' });
		if (this.info.savedStatus === 'publish') {
			setIcon(iconEl, 'check-circle');
			statusRow.addClass('is-published');
			statusRow.createSpan({ text: 'Published' });
		} else if (this.info.savedStatus === 'schedule') {
			setIcon(iconEl, 'clock');
			statusRow.createSpan({ text: 'Scheduled' });
		} else {
			setIcon(iconEl, 'circle');
			statusRow.createSpan({ text: 'Draft' });
		}

		if (this.info.publicUrl) {
			const urlRow = c.createDiv({ cls: 'ghost-updater-public-url' });
			urlRow.createSpan({ text: 'Public URL: ' });
			const link = urlRow.createEl('a', { text: this.info.publicUrl, href: this.info.publicUrl });
			link.setAttr('target', '_blank');
			link.setAttr('rel', 'noopener');
			const copyBtn = urlRow.createEl('button', { cls: 'clickable-icon ghost-updater-copy' });
			setIcon(copyBtn, 'copy');
			copyBtn.setAttr('aria-label', 'Copy public URL');
			copyBtn.addEventListener('click', () => {
				void navigator.clipboard.writeText(this.info.publicUrl).then(() => new Notice('Copied public URL'));
			});
		}
	}

	/** Show the publish-date row only when scheduling. */
	private updateDateVisibility(): void {
		this.dateSetting?.settingEl.toggleClass('ghost-updater-hidden', this.form.status !== 'schedule');
	}

	private async submit(doSync: boolean): Promise<void> {
		const updated = await this.onSubmit(this.form, doSync);
		if (doSync) {
			// Keep the modal open and refresh the status/URL so the live link appears.
			if (updated) this.info = updated;
			this.renderStatus();
		} else {
			this.close();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
