import { App, Modal, Notice, Setting } from 'obsidian';
import { GhostBlog } from '../types';

/**
 * Pick one or more Ghost blogs from a list of toggles. Used to choose which
 * blog(s) a note publishes to (multi-select) and to choose a blog to import from.
 */
export class SelectBlogsModal extends Modal {
	private blogs: GhostBlog[];
	private selected: Set<string>;
	private heading: string;
	private confirmLabel: string;
	private onConfirm: (blogs: GhostBlog[]) => void | Promise<void>;

	constructor(
		app: App,
		blogs: GhostBlog[],
		preselectedIds: string[],
		opts: { heading: string; confirmLabel: string },
		onConfirm: (blogs: GhostBlog[]) => void | Promise<void>
	) {
		super(app);
		this.blogs = blogs;
		this.selected = new Set(preselectedIds);
		this.heading = opts.heading;
		this.confirmLabel = opts.confirmLabel;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: this.heading });

		if (this.blogs.length === 0) {
			contentEl.createEl('p', { text: 'No blogs configured yet — add one in settings.' });
			new Setting(contentEl).addButton(b => b.setButtonText('Close').onClick(() => this.close()));
			return;
		}

		for (const blog of this.blogs) {
			new Setting(contentEl)
				.setName(blog.name)
				.setDesc(blog.url)
				.addToggle(t => t
					.setValue(this.selected.has(blog.id))
					.onChange(v => {
						if (v) this.selected.add(blog.id);
						else this.selected.delete(blog.id);
					}));
		}

		new Setting(contentEl)
			.addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton(b => b.setButtonText(this.confirmLabel).setCta().onClick(() => {
				const chosen = this.blogs.filter(b2 => this.selected.has(b2.id));
				if (chosen.length === 0) { new Notice('Select at least one blog'); return; }
				this.close();
				void this.onConfirm(chosen);
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
