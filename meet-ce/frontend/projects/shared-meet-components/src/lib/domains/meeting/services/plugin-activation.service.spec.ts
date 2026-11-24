import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';
import { RoomMemberContextService } from '../../room-members/services/room-member-context.service';
import { StreamLayoutStateService } from '../openvidu-components/services/layout/stream-layout-state.service';
import { RoomEvent } from '../openvidu-components/services/livekit';
import { MeetingStateService } from './meeting-state.service';
import { PluginActivationService } from './plugin-activation.service';

describe('PluginActivationService', () => {
	const path = '/meet/internal-api/v1/rooms/my-room/plugin-activations';
	const activation = {
		activationId: 'activation-1',
		pluginId: 'attendance',
		pluginVersion: '1.0.1',
		failureCode: null,
		ui: null
	};
	const ui = { title: 'Attendance', url: 'https://calls.example.invalid/apps/plugin-attendance/?callId=RM_one' };
	const active = { ...activation, state: 'ACTIVE' as const, ui };
	const stopPath = `${path}/${activation.activationId}/deactivate`;
	const stopping = { ...activation, state: 'STOPPING' };
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
		initial.flush({ mode: 'manager', canActivate: true, activations: [] });
		await Promise.resolve();

		const start = service.activate('attendance', '1.0.1');
		const post = http.expectOne({ url: path, method: 'POST' });
		expect(post.request.body).toEqual({ callId: 'RM_one', pluginId: 'attendance', pluginVersion: '1.0.1' });
		post.flush({ ...activation, state: 'ACTIVATING' });
		await expectAsync(start).toBeResolvedTo(true);
		expect(service.windows()).toEqual([]);

		(await poll(5000, 'ACTIVE snapshot')).flush({
			mode: 'manager',
			canActivate: true,
			activations: [active]
		});
		await Promise.resolve();
		expect(service.windows()).toEqual([{ id: 'plugin:activation-1', ...ui }]);

		events.get(RoomEvent.Disconnected)?.();
		expect(service.windows()).toEqual([]);
	});

	it('ignores an activation snapshot that arrives after disconnect', async () => {
		const late = await poll(1, 'snapshot in flight at disconnect');
		events.get(RoomEvent.Disconnected)?.();
		late.flush({ mode: 'manager', canActivate: true, activations: [active] });
		await Promise.resolve();
		expect(service.windows()).toEqual([]);
	});

	it('keeps the iframe until the stop is accepted and ignores an older poll', async () => {
		const layout = TestBed.inject(StreamLayoutStateService);
		const windowId = 'plugin:' + activation.activationId;
		const clearWindow = spyOn(layout, 'clearWindow').and.callThrough();
		(await poll(1, 'ACTIVE snapshot')).flush({ mode: 'manager', canActivate: true, activations: [active] });
		await Promise.resolve();

		const stop = service.stop(active.pluginId, active.activationId);
		await service.stop(active.pluginId, active.activationId);
		const post = http.expectOne({ url: stopPath, method: 'POST' });
		expect(post.request.headers.get('x-room-member-token')).toBe('Bearer room-token');
		expect(post.request.body).toEqual({ callId: 'RM_one' });
		expect(service.stopRequest(active.activationId)).toBe('pending');
		expect(service.hasWindow(active.activationId)).toBeTrue();

		const oldPoll = await poll(5000, 'poll started before stop acknowledgement');
		post.flush(stopping, { status: 202, statusText: 'Accepted' });
		await stop;
		expect(service.activations().get(active.pluginId)?.state).toBe('STOPPING');
		expect(service.hasWindow(active.activationId)).toBeFalse();
		expect(service.stopRequest(active.activationId)).toBeUndefined();
		expect(clearWindow).toHaveBeenCalledOnceWith(windowId);

		oldPoll.flush({ mode: 'manager', canActivate: true, activations: [active] });
		await Promise.resolve();
		expect(service.activations().get(active.pluginId)?.state).toBe('STOPPING');
		expect(service.hasWindow(active.activationId)).toBeFalse();
	});

	it('shows stop updates to a participant who cannot request deactivation', async () => {
		(await poll(1, 'ACTIVE snapshot')).flush({ mode: 'manager', canActivate: false, activations: [active] });
		await Promise.resolve();
		await service.stop(active.pluginId, active.activationId);
		http.expectNone(stopPath);
		expect(service.hasWindow(active.activationId)).toBeTrue();

		(await poll(5000, 'STOPPING snapshot')).flush({
			mode: 'manager',
			canActivate: false,
			activations: [stopping]
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(service.hasWindow(active.activationId)).toBeFalse();
		expect(service.activations().get(active.pluginId)?.state).toBe('STOPPING');

		(await poll(5000, 'STOPPED snapshot')).flush({
			mode: 'manager',
			canActivate: false,
			activations: [{ ...stopping, state: 'STOPPED' }]
		});
		await Promise.resolve();
		expect(service.activations().get(active.pluginId)?.state).toBe('STOPPED');
	});

	it('allows retry after a failed stop and keeps the newer activation if the reply is late', async () => {
		(await poll(1, 'ACTIVE snapshot')).flush({ mode: 'manager', canActivate: true, activations: [active] });
		await Promise.resolve();

		const failedStop = service.stop(active.pluginId, active.activationId);
		http.expectOne(stopPath).flush(null, { status: 503, statusText: 'Service Unavailable' });
		await failedStop;
		expect(service.stopRequest(active.activationId)).toBe('failed');
		expect(service.hasWindow(active.activationId)).toBeTrue();

		const retry = service.stop(active.pluginId, active.activationId);
		const lateStop = http.expectOne(stopPath);
		const replacement = { ...active, activationId: 'activation-2' };
		(await poll(5000, 'new activation')).flush({
			mode: 'manager',
			canActivate: true,
			activations: [replacement]
		});
		await Promise.resolve();
		lateStop.flush(stopping, { status: 202, statusText: 'Accepted' });
		await retry;
		expect(service.activations().get(active.pluginId)).toEqual(replacement);
		expect(service.hasWindow(replacement.activationId)).toBeTrue();
	});

	it('keeps the active window during a Manager outage and resumes syncing on recovery', async () => {
		(await poll(1, 'ACTIVE snapshot')).flush({ mode: 'manager', canActivate: true, activations: [active] });
		await Promise.resolve();
		await Promise.resolve();
		(await poll(5000, 'Manager status outage')).flush(null, { status: 503, statusText: 'Service Unavailable' });
		await Promise.resolve();
		await Promise.resolve();
		expect(service.syncFailed()).toBeTrue();
		expect(service.windows()).toEqual([{ id: 'plugin:activation-1', ...ui }]);

		(await poll(5000, 'recovered snapshot')).flush({
			mode: 'manager',
			canActivate: true,
			activations: [{ ...activation, state: 'STOPPED' }]
		});
		await Promise.resolve();
		expect(service.syncFailed()).toBeFalse();
		expect(service.windows()).toEqual([]);
	});
});
