import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';
import { RoomMemberContextService } from '../../room-members/services/room-member-context.service';
import { RoomEvent } from '../openvidu-components/services/livekit';
import { MeetingStateService } from './meeting-state.service';
import { PluginActivationService } from './plugin-activation.service';

describe('PluginActivationService', () => {
	const path = '/meet/internal-api/v1/rooms/my-room/plugin-activations';
	const mockPlugin = { id: 'demo', name: 'Demo', version: '1.0.0' };
	const activation = {
		activationId: 'activation-1',
		pluginId: 'demo',
		pluginVersion: '1.0.0',
		failureCode: null,
		ui: null
	};
	let service: PluginActivationService;
	let http: HttpTestingController;
	let events: Map<RoomEvent, () => void>;

	beforeEach(() => {
		events = new Map();
		const room = {
			name: 'my-room',
			getSid: async () => 'RM_one',
			on: (event: RoomEvent, listener: () => void) => events.set(event, listener),
			off: (event: RoomEvent) => events.delete(event)
		};
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				{ provide: MeetingStateService, useValue: { lkRoom: signal(room) } },
				{ provide: RoomMemberContextService, useValue: { roomMemberToken: signal('room-token') } },
				{
					provide: RuntimeConfigService,
					useValue: {
						isReadyForRequests: () => true,
						resolveUrl: (url: string) => '/meet/' + url
					}
				}
			]
		});
		jasmine.clock().install();
		service = TestBed.inject(PluginActivationService);
		http = TestBed.inject(HttpTestingController);
		TestBed.tick();
	});

	afterEach(() => {
		jasmine.clock().uninstall();
		http.verify();
	});

	async function poll(ms: number, label: string) {
		jasmine.clock().tick(ms);
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		return http.expectOne(path + '?callId=RM_one', label);
	}

	it('uses the room token, waits for ACTIVE, and removes the iframe descriptor on disconnect', async () => {
		const initial = await poll(1, 'initial snapshot');
		expect(initial.request.headers.get('x-room-member-token')).toBe('Bearer room-token');
		initial.flush({ mode: 'mock', canActivate: true, mockPlugin, activations: [] });
		await Promise.resolve();

		const start = service.activate('demo', '1.0.0');
		const post = http.expectOne({ url: path, method: 'POST' });
		expect(post.request.body).toEqual({ callId: 'RM_one', pluginId: 'demo', pluginVersion: '1.0.0' });
		post.flush({ ...activation, state: 'ACTIVATING' });
		await expectAsync(start).toBeResolvedTo(true);
		expect(service.windows()).toEqual([]);

		(await poll(5000, 'ACTIVE snapshot')).flush({
			mode: 'mock',
			canActivate: true,
			mockPlugin,
			activations: [{ ...activation, state: 'ACTIVE' }]
		});
		await Promise.resolve();
		expect(service.windows()).toEqual([{ id: 'plugin:activation-1', title: 'Demo', mock: true }]);

		events.get(RoomEvent.Disconnected)?.();
		expect(service.windows()).toEqual([]);
	});

	it('ignores an activation snapshot that arrives after disconnect', async () => {
		const late = await poll(1, 'snapshot in flight at disconnect');
		events.get(RoomEvent.Disconnected)?.();
		late.flush({ mode: 'mock', canActivate: true, mockPlugin, activations: [{ ...activation, state: 'ACTIVE' }] });
		await Promise.resolve();
		expect(service.windows()).toEqual([]);
	});

	it('shows demo updates and keeps the last real state when Manager status is unavailable', async () => {
		const real = {
			...activation,
			activationId: 'real',
			pluginId: 'notes',
			state: 'FAILED' as const,
			failureCode: 'START_FAILED'
		};
		(await poll(1, 'initial combined snapshot')).flush({
			mode: 'manager',
			canActivate: true,
			mockPlugin,
			activations: [real]
		});
		await Promise.resolve();
		await Promise.resolve();
		(await poll(5000, 'demo snapshot during the Manager outage')).flush({
			mode: 'manager',
			canActivate: true,
			mockPlugin,
			managerStatusUnavailable: true,
			activations: [{ ...activation, state: 'ACTIVE' }]
		});
		await Promise.resolve();
		expect(service.syncFailed()).toBeTrue();
		expect(service.activations().get('notes')).toEqual(real);
		expect(service.windows()).toEqual([{ id: 'plugin:activation-1', title: 'Demo', mock: true }]);
	});
});
