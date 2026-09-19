/**
 * Reloading a plugin in place after its files were replaced.
 *
 * Obsidian's public API has no reload. Its plugin manager has `disablePlugin`
 * and `enablePlugin`, which the settings toggle calls and which re-read
 * `main.js` and `styles.css` from disk; community tools such as BRAT and Hot
 * Reload rely on them. They are undocumented, so nothing here assumes they
 * exist: a host that lacks them yields `null` and the caller falls back to
 * asking for a restart.
 */

export interface PluginHost {
	disablePlugin(id: string): Promise<void>;
	enablePlugin(id: string): Promise<void>;
	/** Manifests Obsidian read at startup; the settings pane shows versions from here. */
	manifests?: Record<string, { version?: string } | undefined>;
}

/** The app's plugin manager, if it has the shape a reload needs. */
export function pluginHost(app: unknown): PluginHost | null {
	if (!app || typeof app !== 'object') return null;
	const plugins = (app as { plugins?: unknown }).plugins;
	if (!plugins || typeof plugins !== 'object') return null;
	const host = plugins as Partial<PluginHost>;
	if (typeof host.disablePlugin !== 'function' || typeof host.enablePlugin !== 'function') return null;
	return plugins as PluginHost;
}

/**
 * Unload and load `id` again. The manifest Obsidian cached at startup is given
 * the installed version first, or the settings pane keeps showing the old one
 * until the next restart even though the new code is running.
 */
export async function reloadPlugin(host: PluginHost, id: string, installedVersion?: string): Promise<void> {
	await host.disablePlugin(id);
	const cached = host.manifests?.[id];
	if (cached && installedVersion) cached.version = installedVersion;
	await host.enablePlugin(id);
}
