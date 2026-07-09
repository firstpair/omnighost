import { ItemView, WorkspaceLeaf, TFile, setIcon, Notice } from 'obsidian';
import { GhostWriterSettings } from '../types';
import { GhostAPIClient } from '../ghost/api-client';
import { GhostPostStatus } from '../types';
import { buildGhostEditorUrl } from '../ghost/url';

export const CALENDAR_VIEW_TYPE = 'ghost-editorial-calendar';

interface CalendarPost {
	id: string;
	title: string;
	status: GhostPostStatus;
	publishedAt: Date;
	vaultFile: TFile | null;
	ghostAdminUrl: string;
}

export class CalendarView extends ItemView {
	private settings: GhostWriterSettings;
	private ghostClient: GhostAPIClient;
	private currentYear: number;
	private currentMonth: number; // 0-indexed
	private posts: CalendarPost[];
	private selectedDay: number | null;
	private monthLabelEl: HTMLElement | null;
	private gridEl: HTMLElement | null;
	private postListEl: HTMLElement | null;

	constructor(leaf: WorkspaceLeaf, settings: GhostWriterSettings, ghostClient: GhostAPIClient) {
		super(leaf);
		this.settings = settings;
		this.ghostClient = ghostClient;
		const now = new Date();
		this.currentYear = now.getFullYear();
		this.currentMonth = now.getMonth();
		this.posts = [];
		this.selectedDay = null;
		this.monthLabelEl = null;
		this.gridEl = null;
		this.postListEl = null;
	}

	getViewType(): string {
		return CALENDAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Ghost calendar';
	}

	getIcon(): string {
		return 'calendar-days';
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('ghost-calendar-view');

		// Build static header
		this.renderHeader(container);

		// Grid wrapper
		const gridWrapper = container.createDiv({ cls: 'ghost-calendar-grid-wrapper' });

		// Weekday labels
		const weekdays = gridWrapper.createDiv({ cls: 'ghost-calendar-weekdays' });
		['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
			weekdays.createSpan({ cls: 'ghost-calendar-weekday', text: day });
		});

		// Grid container (filled by renderGrid)
		this.gridEl = gridWrapper.createDiv({ cls: 'ghost-calendar-grid' });

		// Post list container (filled by renderPostList)
		this.postListEl = container.createDiv({ cls: 'ghost-calendar-post-list' });

		// Load and render
		await this.loadPostsForMonth();
		this.renderGrid();
		this.renderPostList(null); // show all posts on open
	}

	onClose(): Promise<void> {
		this.monthLabelEl = null;
		this.gridEl = null;
		this.postListEl = null;
		return Promise.resolve();
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'ghost-calendar-header' });

		const nav = header.createDiv({ cls: 'ghost-calendar-nav' });

		// Previous year button
		const prevYearBtn = nav.createEl('button', { cls: 'ghost-calendar-nav-btn' });
		prevYearBtn.setAttribute('aria-label', 'Previous year');
		setIcon(prevYearBtn, 'chevrons-left');
		prevYearBtn.addEventListener('click', () => this.navigateYear(-1));
		prevYearBtn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.navigateYear(-1);
			}
		});

		// Previous month button
		const prevMonthBtn = nav.createEl('button', { cls: 'ghost-calendar-nav-btn' });
		prevMonthBtn.setAttribute('aria-label', 'Previous month');
		setIcon(prevMonthBtn, 'chevron-left');
		prevMonthBtn.addEventListener('click', () => this.navigateMonth(-1));
		prevMonthBtn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.navigateMonth(-1);
			}
		});

		// Month/Year label
		this.monthLabelEl = nav.createSpan({ cls: 'ghost-calendar-month-label' });
		this.updateMonthLabel();

		// Next month button
		const nextMonthBtn = nav.createEl('button', { cls: 'ghost-calendar-nav-btn' });
		nextMonthBtn.setAttribute('aria-label', 'Next month');
		setIcon(nextMonthBtn, 'chevron-right');
		nextMonthBtn.addEventListener('click', () => this.navigateMonth(1));
		nextMonthBtn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.navigateMonth(1);
			}
		});

		// Next year button
		const nextYearBtn = nav.createEl('button', { cls: 'ghost-calendar-nav-btn' });
		nextYearBtn.setAttribute('aria-label', 'Next year');
		setIcon(nextYearBtn, 'chevrons-right');
		nextYearBtn.addEventListener('click', () => this.navigateYear(1));
		nextYearBtn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.navigateYear(1);
			}
		});

		// Second row: Today + Refresh buttons
		const toolbar = header.createDiv({ cls: 'ghost-calendar-toolbar' });

		// Today button
		const todayBtn = toolbar.createEl('button', {
			cls: 'ghost-calendar-today-btn',
			text: 'Today'
		});
		todayBtn.setAttribute('aria-label', 'Go to current month');
		todayBtn.addEventListener('click', () => { void this.goToToday(); });
		todayBtn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				void this.goToToday();
			}
		});

		// Refresh button
		const refreshBtn = toolbar.createEl('button', { cls: 'ghost-calendar-refresh-btn' });
		refreshBtn.setAttribute('aria-label', 'Refresh calendar');
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', () => { void this.refresh(); });
		refreshBtn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				void this.refresh();
			}
		});
	}

	private async loadPostsForMonth(): Promise<void> {
		const start = new Date(this.currentYear, this.currentMonth, 1).toISOString();
		const end = new Date(this.currentYear, this.currentMonth + 1, 0, 23, 59, 59).toISOString();
		const filter = `status:[published,scheduled]+published_at:>='${start}'+published_at:<='${end}'`;

		let rawPosts: import('../types').GhostPost[] = [];
		try {
			rawPosts = await this.ghostClient.getPosts(filter, 'all');
		} catch (error) {
			console.error('[Ghost Calendar] Failed to load posts:', error);
			new Notice('Ghost calendar: could not load posts. Check your credentials.');
		}

		const vaultIndex = this.buildVaultIndex();

		this.posts = rawPosts
			.filter(p => p.published_at !== null)
			.map(p => ({
				id: p.id,
				title: p.title || '(untitled)',
				status: p.status,
				publishedAt: new Date(p.published_at as string),
				vaultFile: vaultIndex.get(p.id) ?? null,
				ghostAdminUrl: buildGhostEditorUrl(this.settings.ghostUrl, p.id)
			}))
			.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
	}

	private buildVaultIndex(): Map<string, TFile> {
		const index = new Map<string, TFile>();
		const prefix = this.settings.yamlPrefix;
		const cleanId = `${prefix}id`;
		const perBlogPrefix = `${prefix}id_`;

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.frontmatter) continue;
			for (const key of Object.keys(cache.frontmatter)) {
				if (key !== cleanId && !key.startsWith(perBlogPrefix)) continue;
				const ghostId = cache.frontmatter[key] as unknown;
				if (typeof ghostId === 'string' && ghostId && !index.has(ghostId)) {
					index.set(ghostId, file);
				}
			}
		}

		return index;
	}

	private renderGrid(): void {
		if (!this.gridEl) return;
		this.gridEl.empty();

		const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
		const firstDayOfWeek = new Date(this.currentYear, this.currentMonth, 1).getDay();

		// Track which statuses exist for each day
		const daysWithPublished = new Set<number>();
		const daysWithScheduled = new Set<number>();
		for (const post of this.posts) {
			if (
				post.publishedAt.getFullYear() === this.currentYear &&
				post.publishedAt.getMonth() === this.currentMonth
			) {
				const d = post.publishedAt.getDate();
				if (post.status === 'published') {
					daysWithPublished.add(d);
				} else if (post.status === 'scheduled') {
					daysWithScheduled.add(d);
				}
			}
		}

		// Determine if today falls in the currently displayed month
		const now = new Date();
		const todayDay = (
			now.getFullYear() === this.currentYear &&
			now.getMonth() === this.currentMonth
		) ? now.getDate() : null;

		// Empty cells before first day
		for (let i = 0; i < firstDayOfWeek; i++) {
			this.gridEl.createDiv({ cls: 'ghost-calendar-day-cell ghost-calendar-day-empty' });
		}

		// Day cells
		for (let day = 1; day <= daysInMonth; day++) {
			const hasPublished = daysWithPublished.has(day);
			const hasScheduled = daysWithScheduled.has(day);
			const isToday = day === todayDay;
			const cell = this.renderDayCell(day, hasPublished, hasScheduled, isToday);
			this.gridEl.appendChild(cell);
		}
	}

	private renderDayCell(day: number, hasPublished: boolean, hasScheduled: boolean, isToday: boolean): HTMLElement {
		const cell = createDiv({ cls: 'ghost-calendar-day-cell' });
		const hasPosts = hasPublished || hasScheduled;

		if (isToday) {
			cell.addClass('ghost-calendar-day-today');
		}

		if (hasPosts) {
			cell.addClass('ghost-calendar-day-has-posts');
			cell.setAttribute('role', 'button');
			cell.setAttribute('tabindex', '0');

			// Apply selected state if this day is currently selected
			if (this.selectedDay === day) {
				cell.addClass('ghost-calendar-day-selected');
			}

			const activate = () => {
				if (this.selectedDay === day) {
					// Toggle off: deselect and show all posts
					this.selectedDay = null;
					this.updateGridSelection();
					this.renderPostList(null);
				} else {
					// Select this day and filter list
					this.selectedDay = day;
					this.updateGridSelection();
					this.renderPostList(day);
				}
			};

			cell.addEventListener('click', activate);
			cell.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					activate();
				}
			});
		}

		const numberEl = cell.createSpan({ cls: 'ghost-calendar-day-number', text: String(day) });

		if (hasPublished) numberEl.addClass('ghost-calendar-day-number--published');
		if (hasScheduled) numberEl.addClass('ghost-calendar-day-number--scheduled');

		return cell;
	}

	/**
	 * Update selected/unselected visual state on all day cells
	 * without re-rendering the entire grid.
	 */
	private updateGridSelection(): void {
		if (!this.gridEl) return;
		const cells = this.gridEl.querySelectorAll('.ghost-calendar-day-has-posts');
		cells.forEach((cell) => {
			const dayNum = parseInt(
				(cell.querySelector('.ghost-calendar-day-number') as HTMLElement)?.textContent ?? '0',
				10
			);
			if (this.selectedDay !== null && dayNum === this.selectedDay) {
				cell.addClass('ghost-calendar-day-selected');
			} else {
				cell.removeClass('ghost-calendar-day-selected');
			}
		});
	}

	/**
	 * Render the post list.
	 * - day === null  → show all posts of the month, grouped by day
	 * - day === N     → show only posts of that day
	 */
	private renderPostList(day: number | null): void {
		if (!this.postListEl) return;
		this.postListEl.empty();

		const postsToShow = day === null
			? this.posts
			: this.posts.filter(p =>
				p.publishedAt.getFullYear() === this.currentYear &&
				p.publishedAt.getMonth() === this.currentMonth &&
				p.publishedAt.getDate() === day
			);

		if (postsToShow.length === 0) return;

		if (day === null) {
			// Group by date and render each group
			const byDay = new Map<number, CalendarPost[]>();
			for (const post of postsToShow) {
				const d = post.publishedAt.getDate();
				if (!byDay.has(d)) byDay.set(d, []);
				(byDay.get(d) as CalendarPost[]).push(post);
			}

			for (const [d, dayPosts] of byDay) {
				this.renderDayGroup(d, dayPosts);
			}
		} else {
			// Single day — one group
			this.renderDayGroup(day, postsToShow);
		}
	}

	private renderDayGroup(day: number, posts: CalendarPost[]): void {
		if (!this.postListEl) return;

		const dateLabel = new Date(this.currentYear, this.currentMonth, day)
			.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

		const group = this.postListEl.createDiv({ cls: 'ghost-calendar-day-group' });
		group.createDiv({ cls: 'ghost-calendar-list-header' })
			.createSpan({ cls: 'ghost-calendar-list-date', text: dateLabel });

		for (const post of posts) {
			group.appendChild(this.renderPostItem(post));
		}
	}

	private renderPostItem(post: CalendarPost): HTMLElement {
		const item = createDiv({ cls: 'ghost-calendar-post-item' });

		// Status badge
		const statusCls = post.status === 'published'
			? 'ghost-calendar-post-status--published'
			: 'ghost-calendar-post-status--scheduled';
		item.createSpan({ cls: `ghost-calendar-post-status ${statusCls}`, text: post.status });

		// Title link — opens vault note in new tab if exists, else Ghost Admin
		const titleLink = item.createEl('a', {
			cls: 'ghost-calendar-post-link',
			text: post.title
		});

		if (post.vaultFile instanceof TFile) {
			const vaultFile = post.vaultFile;
			titleLink.setAttribute('href', '#');
			titleLink.addEventListener('click', (e) => {
				e.preventDefault();
				const leaf = this.app.workspace.getLeaf('tab');
				void leaf.openFile(vaultFile);
			});
		} else {
			titleLink.setAttribute('href', post.ghostAdminUrl);
			titleLink.setAttribute('target', '_blank');
			titleLink.setAttribute('rel', 'noopener noreferrer');
		}

		// External link icon — always opens Ghost Admin
		const extLink = item.createEl('a', { cls: 'ghost-calendar-post-external' });
		extLink.setAttribute('href', post.ghostAdminUrl);
		extLink.setAttribute('target', '_blank');
		extLink.setAttribute('rel', 'noopener noreferrer');
		extLink.setAttribute('aria-label', 'Open in ghost admin');
		setIcon(extLink, 'external-link');

		return item;
	}

	private async goToToday(): Promise<void> {
		const now = new Date();
		this.currentYear = now.getFullYear();
		this.currentMonth = now.getMonth();
		await this.refresh();
	}

	private navigateMonth(delta: number): void {
		this.currentMonth += delta;
		if (this.currentMonth > 11) {
			this.currentMonth = 0;
			this.currentYear += 1;
		} else if (this.currentMonth < 0) {
			this.currentMonth = 11;
			this.currentYear -= 1;
		}
		void this.refresh();
	}

	private navigateYear(delta: number): void {
		this.currentYear += delta;
		void this.refresh();
	}

	private async refresh(): Promise<void> {
		this.selectedDay = null;
		this.updateMonthLabel();
		await this.loadPostsForMonth();
		this.renderGrid();
		this.renderPostList(null);
	}

	private updateMonthLabel(): void {
		if (!this.monthLabelEl) return;
		const label = new Date(this.currentYear, this.currentMonth, 1)
			.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
		this.monthLabelEl.setText(label);
	}
}
