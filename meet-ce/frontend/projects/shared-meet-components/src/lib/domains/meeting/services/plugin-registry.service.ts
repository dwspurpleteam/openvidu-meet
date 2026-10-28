import { inject, Service } from '@angular/core';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';

export interface PluginCatalogEntry {
	id: string;
	version: string;
	name: string;
	description: string;
}

export interface PluginCatalogPage {
	items: readonly PluginCatalogEntry[];
	page: number;
	limit: number;
	totalItems: number;
	totalPages: number;
}

export interface PluginManifest {
	'manifest-version': '1.0';
	'plugin-id': string;
	'plugin-version': string;
	name: string;
	description: string;
	frontend: {
		'sdk-version': string;
		'url-web': string;
	};
}

const MOCK_PLUGINS: readonly PluginCatalogEntry[] = [
	{ id: 'transcript', version: '1.0.0', name: 'Transcript', description: 'Sample transcript with personal notes.' },
	{ id: 'notes', version: '1.0.0', name: 'Notes', description: 'A sample notepad for the meeting.' },
	{ id: 'restricted', version: '1.0.0', name: 'Restricted plugin', description: 'Permission-denied test scenario.' },
	{ id: 'rejected', version: '1.0.0', name: 'Rejected plugin', description: 'Activation-rejected test scenario.' }
];

@Service()
export class PluginRegistryService {
	private readonly runtimeConfig = inject(RuntimeConfigService);
	readonly registryId = 'mock-registry';

	// ponytail: in-memory catalog; replace these methods with Registry HTTP calls when its DTOs are agreed.
	async list(page = 1, limit = 20): Promise<PluginCatalogPage> {
		if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
			throw new Error('Invalid plugin catalog pagination');
		}

		return {
			items: MOCK_PLUGINS.slice((page - 1) * limit, page * limit),
			page,
			limit,
			totalItems: MOCK_PLUGINS.length,
			totalPages: Math.ceil(MOCK_PLUGINS.length / limit)
		};
	}

	find(id: string): PluginCatalogEntry | undefined {
		return MOCK_PLUGINS.find((plugin) => plugin.id === id);
	}

	uiUrl(id: string): string {
		if (!this.find(id)) {
			throw new Error('Unknown plugin');
		}

		return this.runtimeConfig.resolveUrl(`assets/plugin-demo/${id === 'notes' ? 'notes' : 'transcript'}.html`);
	}

	async getManifest(id: string, version: string): Promise<PluginManifest> {
		const plugin = this.find(id);

		if (!plugin || plugin.version !== version) {
			throw new Error('Unknown plugin version');
		}

		return {
			'manifest-version': '1.0',
			'plugin-id': plugin.id,
			'plugin-version': plugin.version,
			name: plugin.name,
			description: plugin.description,
			frontend: {
				'sdk-version': '1.0.0',
				'url-web': this.uiUrl(id)
			}
		};
	}
}
