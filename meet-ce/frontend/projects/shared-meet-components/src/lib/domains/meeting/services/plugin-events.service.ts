import { effect, inject, Service, untracked } from '@angular/core';
import { Subject } from 'rxjs';
import {
	RoomEvent,
	type DataPacket_Kind,
	type RemoteParticipant,
	type Room
} from '../openvidu-components/services/livekit';
import { MeetingStateService } from './meeting-state.service';

export interface PluginEvent {
	activationId: string;
	callId: string;
	name: string;
	data: string;
}

const PLUGIN_EVENT_TOPIC = 'plugin.event.v1';
const MAX_EVENT_BYTES = 15 * 1024;

@Service()
export class PluginEventsService {
	private readonly meetingState = inject(MeetingStateService);
	private readonly eventSubject = new Subject<PluginEvent>();
	readonly events = this.eventSubject.asObservable();

	constructor() {
		effect((onCleanup) => {
			const room = this.meetingState.lkRoom();

			if (room) untracked(() => onCleanup(this.attach(room)));
		});
	}

	private attach(room: Room): () => void {
		let callId = '';
		let active = true;

		const syncCallId = async () => {
			try {
				const current = await room.getSid();

				if (active) callId = current;
			} catch {
				if (active) callId = '';
			}
		};

		const onData = (
			payload: Uint8Array,
			participant?: RemoteParticipant,
			_kind?: DataPacket_Kind,
			topic?: string
		) => {
			if (
				!active ||
				!callId ||
				participant ||
				topic !== PLUGIN_EVENT_TOPIC ||
				payload.byteLength > MAX_EVENT_BYTES
			)
				return;

			try {
				const message: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));

				if (!message || typeof message !== 'object') return;

				const event = message as Partial<PluginEvent>;

				if (
					event.callId !== callId ||
					typeof event.activationId !== 'string' ||
					!event.activationId ||
					typeof event.name !== 'string' ||
					!event.name ||
					typeof event.data !== 'string'
				)
					return;

				this.eventSubject.next({
					activationId: event.activationId,
					callId: event.callId,
					name: event.name,
					data: event.data
				});
			} catch {
				// Malformed data must not interrupt the call.
			}
		};

		room.on(RoomEvent.DataReceived, onData);
		room.on(RoomEvent.Reconnected, syncCallId);
		void syncCallId();

		return () => {
			active = false;
			room.off(RoomEvent.DataReceived, onData);
			room.off(RoomEvent.Reconnected, syncCallId);
		};
	}
}
