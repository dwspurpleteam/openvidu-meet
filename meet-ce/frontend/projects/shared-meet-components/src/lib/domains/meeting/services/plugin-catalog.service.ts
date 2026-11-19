import { HttpBackend, HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';

export interface RegistryPlugin {
	id: string;
	name: string;
	description: string;
}

interface RegistryPage {
	items: RegistryPlugin[];
	totalPages: number;
}

@Service()
export class PluginCatalogService {
	private readonly http = new HttpClient(inject(HttpBackend));
	private readonly runtimeConfig = inject(RuntimeConfigService);

	async list(page = 1, limit = 20): Promise<RegistryPage> {
		const origin = new URL(this.runtimeConfig.serverBaseUrl() || window.location.origin).origin;
		return lastValueFrom(
			this.http.get<RegistryPage>(`${origin}/v1/plugins`, {
				params: { page, limit },
				withCredentials: true
			})
		);
	}
}
