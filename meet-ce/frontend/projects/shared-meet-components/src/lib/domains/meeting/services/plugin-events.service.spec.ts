import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Room, RoomEvent } from '../openvidu-components/services/livekit';
import { MeetingStateService } from './meeting-state.service';
import { PluginEvent, PluginEventsService } from './plugin-events.service';

class MockRoom {
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

	receive(message: unknown, participant?: object, topic = 'plugin.event.v1'): void {
		this.handlers
			.get(RoomEvent.DataReceived)
			?.forEach((handler) =>
				handler(new TextEncoder().encode(JSON.stringify(message)), participant, undefined, topic)
			);
	}
}

async function flush(): Promise<void> {
	TestBed.tick();

	for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('PluginEventsService', () => {
	it('emits only server events for the current call and detaches after leaving', async () => {
		const room = new MockRoom();
		const lkRoom = signal<Room | undefined>(room as unknown as Room);
		TestBed.configureTestingModule({ providers: [{ provide: MeetingStateService, useValue: { lkRoom } }] });
		const service = TestBed.inject(PluginEventsService);
		const received: PluginEvent[] = [];
		const sub = service.events.subscribe((event) => received.push(event));
		await flush();
		const event = { activationId: 'activation', callId: 'RM_call', name: 'subtitle.updated', data: 'hello' };
		room.receive(event);
		room.receive(event, { identity: 'untrusted' });
		room.receive({ ...event, callId: 'RM_other' });
		room.receive({ ...event, data: 42 });
		room.receive(event, undefined, 'other-topic');
		expect(received).toEqual([event]);
		lkRoom.set(undefined);
		await flush();
		room.receive(event);
		expect(received).toEqual([event]);
		sub.unsubscribe();
	});
});
