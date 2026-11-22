import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';
import { PluginCatalogService } from './plugin-catalog.service';

describe('PluginCatalogService', () => {
	let service: PluginCatalogService;
	let http: HttpTestingController;
	const registryUrl = 'https://meet.example/v1/plugins';

	beforeEach(() => {
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
		service = TestBed.inject(PluginCatalogService);
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	it('loads a Registry page without Meet authorization headers', async () => {
		const result = service.list(2, 10);
		const request = http.expectOne(`${registryUrl}?page=2&limit=10`);
		expect(request.request.headers.has('Authorization')).toBeFalse();
		expect(request.request.withCredentials).toBeTrue();
		request.flush({ items: [{ id: 'p', name: 'Plugin', description: 'Description' }], totalPages: 2 });
		expect((await result).items[0].id).toBe('p');
	});

	it('reads all pages of explicit versions and encodes the registry ID', async () => {
		const result = service.listVersions('90+');
		const path = `${registryUrl}/90%2B/versions`;
		http.expectOne(path + '?page=1&limit=20').flush({ items: [{ version: '0.1.0' }], totalPages: 2 });
		await Promise.resolve();
		http.expectOne(path + '?page=2&limit=20').flush({ items: [{ version: '0.2.0' }], totalPages: 2 });
		expect(await result).toEqual(['0.1.0', '0.2.0']);
	});

	it('reads permissions for the exact version and prefers explicit event types', async () => {
		const result = service.getPermissions('90+', '1.0.0+build');
		const request = http.expectOne(`${registryUrl}/90%2B/versions/1.0.0%2Bbuild/manifest`);
		expect(request.request.method).toBe('GET');
		expect(request.request.headers.has('Authorization')).toBeFalse();
		expect(request.request.withCredentials).toBeTrue();
		request.flush({
			'plugin-id': '90+',
			'plugin-version': '1.0.0+build',
			'manifest-version': '1.1',
			backend: {
				'initial-state': ['participants'],
				events: {
					'available-event-types': ['participant.joined', 'future.event', 'participant.joined'],
					'available-event-groups': ['call']
				},
				media: { input: ['AUDIO', 'FUTURE_MEDIA'], output: ['SCREEN_SHARE_AUDIO'] },
				actions: ['notes.add']
			}
		});
		expect(await result).toEqual([
			{ kind: 'INITIAL_STATE', values: ['participants'] },
			{ kind: 'EVENT_TYPES', values: ['participant.joined', 'future.event'] },
			{ kind: 'MEDIA_INPUT', values: ['AUDIO', 'FUTURE_MEDIA'] },
			{ kind: 'MEDIA_OUTPUT', values: ['SCREEN_SHARE_AUDIO'] },
			{ kind: 'ACTIONS', values: ['notes.add'] }
		]);
	});

	it('reads the published historical event format without current backend fields', async () => {
		const result = service.getPermissions('attendance', '0.1.0');
		http.expectOne(`${registryUrl}/attendance/versions/0.1.0/manifest`).flush({
			'plugin-id': 'attendance',
			'plugin-version': '0.1.0',
			'manifest-version': '0.1',
			backend: {
				events: {
					'event-url': 'https://plugin.example/events',
					'available-event-types': ['participant.joined', 'participant.left']
				},
				media: { input: [], output: [] }
			}
		});
		expect(await result).toEqual([{ kind: 'EVENT_TYPES', values: ['participant.joined', 'participant.left'] }]);
	});

	it('reads event groups when explicit types are absent', async () => {
		const result = service.getPermissions('notes', '1.0.0');
		http.expectOne(`${registryUrl}/notes/versions/1.0.0/manifest`).flush({
			'plugin-id': 'notes',
			'plugin-version': '1.0.0',
			backend: { events: { 'available-event-groups': ['participant', 'future_group'] } }
		});
		expect(await result).toEqual([{ kind: 'EVENT_GROUPS', values: ['participant', 'future_group'] }]);
	});

	it('rejects a response for another version', async () => {
		const result = service.getPermissions('notes', '1.0.0');
		http.expectOne(`${registryUrl}/notes/versions/1.0.0/manifest`).flush({
			'plugin-id': 'notes',
			'plugin-version': '2.0.0',
			backend: {}
		});
		await expectAsync(result).toBeRejected();
	});

	it('rejects a malformed permission list instead of reporting no permissions', async () => {
		const result = service.getPermissions('notes', '1.0.0');
		http.expectOne(`${registryUrl}/notes/versions/1.0.0/manifest`).flush({
			'plugin-id': 'notes',
			'plugin-version': '1.0.0',
			backend: { media: { input: 'AUDIO' } }
		});
		await expectAsync(result).toBeRejected();
	});
});
