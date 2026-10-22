import chalk from 'chalk';
import { z } from 'zod';
import { MEET_ENV } from '../environment.js';

const PluginsSchema = z
	.array(
		z.object({
			id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must contain only lowercase letters, digits and hyphens'),
			title: z.string().trim().min(1, 'title cannot be empty'),
			url: z.url('url must be a valid URL').regex(/^https?:\/\//, 'url must start with http:// or https://')
		})
	)
	.refine((plugins) => new Set(plugins.map((plugin) => plugin.id)).size === plugins.length, 'ids must be unique');

export type MeetPluginConfig = z.infer<typeof PluginsSchema>[number];

let cachedPlugins: MeetPluginConfig[] | undefined;

/**
 * Parses MEET_PLUGINS, a JSON array of `{ id, title, url }`. An invalid value is reported and ignored,
 * so a misconfigured plugin never keeps meetings from loading.
 */
export function parsePlugins(value: string): MeetPluginConfig[] {
	if (!value.trim()) {
		return [];
	}

	try {
		return PluginsSchema.parse(JSON.parse(value));
	} catch (error) {
		const reason = error instanceof z.ZodError ? z.prettifyError(error) : String(error);
		console.warn(chalk.yellow('⚠️  WARNING: MEET_PLUGINS is ignored:'), chalk.cyan(reason));
		return [];
	}
}

/**
 * Plugin pages participants can open in a meeting window, parsed once from MEET_PLUGINS.
 */
export function getPlugins(): MeetPluginConfig[] {
	cachedPlugins ??= parsePlugins(MEET_ENV.PLUGINS);
	return cachedPlugins;
}
