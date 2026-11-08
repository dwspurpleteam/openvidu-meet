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
});
