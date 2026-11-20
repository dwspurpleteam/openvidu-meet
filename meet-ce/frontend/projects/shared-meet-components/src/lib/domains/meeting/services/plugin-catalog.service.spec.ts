import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';
import { PluginCatalogService } from './plugin-catalog.service';

describe('PluginCatalogService', () => {
	it('loads a Registry page without Meet authorization headers', async () => {
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(
					withInterceptors([
						(request, next) => next(request.clone({ setHeaders: { Authorization: 'secret' } }))
					])
				),
				provideHttpClientTesting(),
				{ provide: RuntimeConfigService, useValue: { serverBaseUrl: () => 'https://meet.example/meet' } }
			]
		});
		const service = TestBed.inject(PluginCatalogService);
		const http = TestBed.inject(HttpTestingController);
		const result = service.list(2, 10);
		const request = http.expectOne('https://meet.example/v1/plugins?page=2&limit=10');
		expect(request.request.headers.has('Authorization')).toBeFalse();
		expect(request.request.withCredentials).toBeTrue();
		request.flush({ items: [{ id: 'p', name: 'Plugin', description: 'Description' }], totalPages: 2 });
		expect((await result).items[0].id).toBe('p');
		http.verify();
	});

	it('reads all pages of explicit versions and encodes the registry ID', async () => {
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				{ provide: RuntimeConfigService, useValue: { serverBaseUrl: () => 'https://meet.example/meet' } }
			]
		});
		const service = TestBed.inject(PluginCatalogService);
		const http = TestBed.inject(HttpTestingController);
		const result = service.listVersions('90+');
		const path = 'https://meet.example/v1/plugins/90%2B/versions';
		http.expectOne(path + '?page=1&limit=20').flush({ items: [{ version: '0.1.0' }], totalPages: 2 });
		await Promise.resolve();
		http.expectOne(path + '?page=2&limit=20').flush({ items: [{ version: '0.2.0' }], totalPages: 2 });
		expect(await result).toEqual(['0.1.0', '0.2.0']);
		http.verify();
	});
});
