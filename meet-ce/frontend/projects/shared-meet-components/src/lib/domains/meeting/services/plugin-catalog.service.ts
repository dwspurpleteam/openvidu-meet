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

@Service()
export class PluginCatalogService {
	private readonly http = new HttpClient(inject(HttpBackend));
	private readonly runtimeConfig = inject(RuntimeConfigService);

	async list(page = 1, limit = 20): Promise<RegistryPage> {
		return this.getPage<RegistryPage>('', page, limit);
	}

	async listVersions(pluginId: string): Promise<string[]> {
		const versions = new Set<string>();
		let page = 1;
		let totalPages: number;

		do {
			const result = await this.getPage<PluginVersionPage>(
				'/' + encodeURIComponent(pluginId) + '/versions',
				page++,
				20
			);
			result.items.forEach(({ version }) => versions.add(version));
			totalPages = result.totalPages;
		} while (page <= totalPages);

		return [...versions];
	}

	private getPage<T>(path: string, page: number, limit: number): Promise<T> {
		const origin = new URL(this.runtimeConfig.serverBaseUrl() || window.location.origin).origin;
		return lastValueFrom(
			this.http.get<T>(`${origin}/v1/plugins${path}`, {
				params: { page, limit },
				withCredentials: true,
				timeout: 5000
			})
		);
	}
}
