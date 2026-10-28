import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';
import { ConnectionState, Room, RoomEvent } from '../openvidu-components/services/livekit';
import { MeetingStateService } from './meeting-state.service';
import { PluginManagerService } from './plugin-manager.service';
import { PluginRegistryService } from './plugin-registry.service';

const topic = 'meet.plugins.mock.v1';

class MockRoom {
	state = ConnectionState.Connected;
	localParticipant = {
		identity: 'viewer',
		permissions: { canPublishData: true },
		publishData: jasmine.createSpy('publishData').and.resolveTo()
	};
	getSid = jasmine.createSpy('getSid').and.resolveTo('RM_call');
	private handlers = new Map<string, Set<(...args: any[]) => void>>();

	on(event: string, handler: (...args: any[]) => void): this {
		const handlers = this.handlers.get(event) ?? new Set();
		handlers.add(handler);
		this.handlers.set(event, handlers);
		return this;
	}

	off(event: string, handler: (...args: any[]) => void): this {
		this.handlers.get(event)?.delete(handler);
		return this;
	}

	emit(event: string, ...args: unknown[]): void {
		this.handlers.get(event)?.forEach((handler) => handler(...args));
	}

	receive(message: unknown, dataTopic = topic): void {
		this.emit(
			RoomEvent.DataReceived,
			new TextEncoder().encode(JSON.stringify(message)),
			{ identity: 'peer' },
			undefined,
			dataTopic
		);
	}

	messages(): any[] {
		return this.localParticipant.publishData.calls
			.allArgs()
			.map(([payload]) => JSON.parse(new TextDecoder().decode(payload)));
	}
}

async function flush(): Promise<void> {
	TestBed.tick();

	for (let index = 0; index < 12; index++) await Promise.resolve();
}

describe('Plugin Manager mock', () => {
	let room: MockRoom;
	let lkRoom: ReturnType<typeof signal<Room | undefined>>;
	let manager: PluginManagerService;

	beforeEach(async () => {
		room = new MockRoom();
		lkRoom = signal<Room | undefined>(room as unknown as Room);
		TestBed.configureTestingModule({
			providers: [
				{ provide: MeetingStateService, useValue: { lkRoom } },
				{ provide: RuntimeConfigService, useValue: { resolveUrl: (url: string) => `/meet/${url}` } }
			]
		});
		manager = TestBed.inject(PluginManagerService);
		await flush();
	});

	it('uses Registry pagination and manifest field names', async () => {
		const registry = TestBed.inject(PluginRegistryService);
		const first = await registry.list(1, 2);
		const second = await registry.list(2, 2);
		expect(first.items.map((item) => item.id)).toEqual(['transcript', 'notes']);
		expect(second.items.map((item) => item.id)).toEqual(['restricted', 'rejected']);
		expect(first.totalPages).toBe(2);
		expect((await registry.getManifest('notes', '1.0.0')).frontend['url-web']).toBe(
			'/meet/assets/plugin-demo/notes.html'
		);
		await expectAsync(registry.list(0)).toBeRejected();
		await expectAsync(registry.getManifest('unknown', '1.0.0')).toBeRejected();
	});

	it('activates several plugins, prevents duplicates and stops only the selected activation', async () => {
		const activation = manager.activate('transcript');
		expect(manager.pending()['transcript']).toBe('ACTIVATING');
		await manager.activate('transcript');
		await activation;
		await manager.activate('notes');
		expect(manager.activations().length).toBe(2);
		const transcript = manager.activations().find((item) => item.pluginId === 'transcript')!;
		await manager.stop(transcript.activationId);
		expect(manager.activations().map((item) => item.pluginId)).toEqual(['notes']);
		await manager.activate('transcript');
		expect(manager.activations().find((item) => item.pluginId === 'transcript')!.activationId).not.toBe(
			transcript.activationId
		);
	});

	it('distinguishes permission denial and rejected activation without creating an iframe descriptor', async () => {
		await manager.activate('restricted');
		await manager.activate('rejected');
		expect(manager.errors()['restricted']).toBe('FORBIDDEN');
		expect(manager.errors()['rejected']).toBe('REJECTED');
		expect(manager.activations()).toEqual([]);
		expect(manager.pending()['rejected']).toBeUndefined();
	});

	it('keeps an active plugin after a failed stop and allows retry', async () => {
		await manager.activate('notes');
		const activation = manager.activations()[0]!;
		room.localParticipant.publishData.and.rejectWith(new Error('offline'));
		await manager.stop(activation.activationId);
		expect(manager.activations()[0]!.activationId).toBe(activation.activationId);
		expect(manager.errors()['notes']).toBe('STOP_FAILED');
		room.localParticipant.publishData.and.resolveTo();
		await manager.stop(activation.activationId);
		expect(manager.activations()).toEqual([]);
	});

	it('does not activate locally if the common-call update fails', async () => {
		room.localParticipant.publishData.and.rejectWith(new Error('offline'));
		await manager.activate('notes');
		expect(manager.activations()).toEqual([]);
		expect(manager.errors()['notes']).toBe('ACTIVATION_FAILED');
	});

	it('requests a snapshot and replies to a late participant with current activations', async () => {
		expect(room.messages().some((message) => message.type === 'request')).toBeTrue();
		await manager.activate('notes');
		room.receive({ version: 1, type: 'request', callId: 'RM_call' });
		await flush();
		const message = room.messages().at(-1);
		expect(message.items[0].pluginId).toBe('notes');
		expect(room.localParticipant.publishData.calls.mostRecent().args[1].destinationIdentities).toEqual(['peer']);
	});

	it('merges common state, ignores duplicate/stale snapshots and preserves stop tombstones', async () => {
		await manager.activate('notes');
		const active = room
			.messages()
			.filter((message) => message.items.length)
			.at(-1);
		await manager.stop(manager.activations()[0]!.activationId);
		room.receive(active);
		room.receive(active);
		expect(manager.activations()).toEqual([]);
		const newer = { ...active.items[0], revision: 3, writer: 'peer', activationId: 'new-activation' };
		room.receive({ ...active, items: [newer] });
		expect(manager.activations()[0]!.activationId).toBe('new-activation');
	});

	it('ignores another call, malformed payload, wrong topic and untrusted URL fields', async () => {
		await manager.activate('notes');
		const snapshot = room
			.messages()
			.filter((message) => message.items.length)
			.at(-1);
		await manager.stop(manager.activations()[0]!.activationId);
		const item = { ...snapshot.items[0], revision: 5 };
		room.receive({ ...snapshot, callId: 'RM_other', items: [item] });
		room.receive({ ...snapshot, items: [{ ...item, callId: 'RM_other' }] });
		room.receive({ ...snapshot, items: [{ ...item, pluginId: 'unknown' }] });
		room.receive({ ...snapshot, items: [{ ...item, revision: '5' }] });
		room.receive({ ...snapshot, items: [item] }, 'other-topic');
		room.emit(RoomEvent.DataReceived, new TextEncoder().encode('{'), { identity: 'peer' }, undefined, topic);
		expect(manager.activations()).toEqual([]);
	});

	it('resynchronizes after reconnect and clears state and listeners on leaving', async () => {
		await manager.activate('notes');
		room.state = ConnectionState.Reconnecting;
		room.emit(RoomEvent.ConnectionStateChanged);
		expect(manager.connected()).toBeFalse();
		room.state = ConnectionState.Connected;
		room.emit(RoomEvent.Reconnected);
		await flush();
		expect(manager.connected()).toBeTrue();
		expect(room.messages().at(-1).type).toBe('request');
		lkRoom.set(undefined);
		await flush();
		expect(manager.activations()).toEqual([]);
		expect(manager.connected()).toBeFalse();
		const count = room.messages().length;
		room.receive({ version: 1, callId: 'RM_call', type: 'request' });
		expect(room.messages().length).toBe(count);
	});

	it('ignores an activation completing after leaving the call', async () => {
		let complete!: () => void;
		room.localParticipant.publishData.and.callFake(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve;
				})
		);
		const activation = manager.activate('notes');
		await flush();
		lkRoom.set(undefined);
		await flush();
		complete();
		await activation;
		expect(manager.activations()).toEqual([]);
		expect(manager.pending()).toEqual({});
	});
});
