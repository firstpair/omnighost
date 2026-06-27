import tsparser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

// tseslint.config() resolves the 'extends' key in the plugin's hybrid configs
const resolvedBase = tseslint.config(...obsidianmd.configs.recommended);

// Inject parserOptions.project into any config that targets .ts files and sets the TS parser
// (this is needed for type-aware rules like no-plugin-as-component)
const configs = resolvedBase.map((config) => {
	const targetsTs = config.files?.some((f) =>
		typeof f === "string" && f.includes(".ts")
	);
	const hasParser =
		config.languageOptions?.parser?.meta?.name === "typescript-eslint/parser";

	if (targetsTs && hasParser) {
		return {
			...config,
			languageOptions: {
				...config.languageOptions,
				parserOptions: {
					...(config.languageOptions.parserOptions ?? {}),
					project: true,
					tsconfigRootDir: import.meta.dirname,
				},
			},
		};
	}
	return config;
});

export default [
	{ ignores: [".claude/", "node_modules/", "**/main.js", "dist-ios/", "release/", "*.mjs", "package.json"] },
	...configs,
	// Add browser/Obsidian globals and override rules for TS files
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: true,
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.browser,
				...globals.node,
				activeWindow: "readonly",
				activeDocument: "readonly",
				createDiv: "readonly",
				createEl: "readonly",
				createSpan: "readonly",
				createFragment: "readonly",
			},
		},
		rules: {},
	},
];
