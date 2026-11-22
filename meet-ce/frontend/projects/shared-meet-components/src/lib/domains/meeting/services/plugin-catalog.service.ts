import { HttpBackend, HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';

export interface RegistryPlugin {
	id: string;
	name: string;
	description: string | null;
}

interface RegistryPage {
	items: RegistryPlugin[];
	totalPages: number;
}

interface PluginVersionPage {
	items: { version: string }[];
	totalPages: number;
}

export type PluginPermissionKind =
	'INITIAL_STATE' | 'EVENT_TYPES' | 'EVENT_GROUPS' | 'MEDIA_INPUT' | 'MEDIA_OUTPUT' | 'ACTIONS';

export interface PluginPermissionGroup {
	kind: PluginPermissionKind;
	values: string[];
}

@Service()
export class PluginCatalogService {
	private readonly http = new HttpClient(inject(HttpBackend));
	private readonly runtimeConfig = inject(RuntimeConfigService);

	async list(page = 1, limit = 20): Promise<RegistryPage> {
		return this.get<RegistryPage>('', { page, limit });
	}

	async listVersions(pluginId: string): Promise<string[]> {
		const versions = new Set<string>();
		let page = 1;
		let totalPages: number;

		do {
			const result = await this.get<PluginVersionPage>(`/${encodeURIComponent(pluginId)}/versions`, {
				page: page++,
				limit: 20
			});
			result.items.forEach(({ version }) => versions.add(version));
			totalPages = result.totalPages;
		} while (page <= totalPages);

		return [...versions];
	}

	async getPermissions(pluginId: string, version: string): Promise<PluginPermissionGroup[]> {
		const path = `/${encodeURIComponent(pluginId)}/versions/${encodeURIComponent(version)}/manifest`;
		const manifest = readObject(await this.get<unknown>(path));

		if (manifest['plugin-id'] !== pluginId || manifest['plugin-version'] !== version) {
			throw new Error('Registry returned a manifest for another plugin or version');
		}

		const backend = readObject(manifest['backend']);
		const events = readOptionalObject(backend['events']);
		const media = readOptionalObject(backend['media']);
		const groups: PluginPermissionGroup[] = [
			{ kind: 'INITIAL_STATE', values: readPermissionValues(backend['initial-state']) },
			events['available-event-types'] === undefined
				? { kind: 'EVENT_GROUPS', values: readPermissionValues(events['available-event-groups']) }
				: { kind: 'EVENT_TYPES', values: readPermissionValues(events['available-event-types']) },
			{ kind: 'MEDIA_INPUT', values: readPermissionValues(media['input']) },
			{ kind: 'MEDIA_OUTPUT', values: readPermissionValues(media['output']) },
			{ kind: 'ACTIONS', values: readPermissionValues(backend['actions']) }
		];

		return groups.filter(({ values }) => values.length > 0);
	}

	private get<T>(path: string, params?: Record<string, number>): Promise<T> {
		const origin = new URL(this.runtimeConfig.serverBaseUrl() || window.location.origin).origin;
		return lastValueFrom(
			this.http.get<T>(`${origin}/v1/plugins${path}`, {
				params,
				withCredentials: true,
				timeout: 5000
			})
		);
	}
}

function readObject(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Registry returned an invalid plugin manifest');
	}

	return value as Record<string, unknown>;
}

function readOptionalObject(value: unknown): Record<string, unknown> {
	return value === undefined ? {} : readObject(value);
}

function readPermissionValues(value: unknown): string[] {
	if (value === undefined) return [];

	if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim())) {
		throw new Error('Registry returned an invalid plugin permission list');
	}

	return [...new Set<string>(value)];
}
