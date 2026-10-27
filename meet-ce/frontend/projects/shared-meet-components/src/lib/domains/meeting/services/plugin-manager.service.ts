import { computed, effect, inject, Service, signal, untracked } from '@angular/core';
import {
	ConnectionState,
	RoomEvent,
	type DataPacket_Kind,
	type RemoteParticipant,
	type Room
} from '../openvidu-components/services/livekit';
import { MeetingStateService } from './meeting-state.service';
import { PluginRegistryService } from './plugin-registry.service';

export type PluginActivationState =
	'ACTIVATING' | 'ACTIVE' | 'DEGRADED' | 'SUSPENDING' | 'SUSPENDED' | 'RESUMING' | 'STOPPING' | 'STOPPED' | 'FAILED';

export interface PluginActivation {
	activationId: string;
	callId: string;
	pluginId: string;
	pluginVersion: string;
	registryId: string;
	state: PluginActivationState;
	stateChangedAt: string;
	idempotencyKey: string;
}

export type PluginActionError = 'FORBIDDEN' | 'REJECTED' | 'ACTIVATION_FAILED' | 'STOP_FAILED';

interface MockActivation extends PluginActivation {
	revision: number;
	writer: string;
}

interface MockSession {
	room: Room;
	callId: string;
}

const MOCK_TOPIC = 'meet.plugins.mock.v1';

@Service()
export class PluginManagerService {
	private readonly meetingState = inject(MeetingStateService);
	private readonly registry = inject(PluginRegistryService);
	private readonly records = signal<readonly MockActivation[]>([]);
	private readonly _connected = signal(false);
	private readonly _syncFailed = signal(false);
	private readonly _pending = signal<Readonly<Record<string, 'ACTIVATING' | 'STOPPING' | undefined>>>({});
	private readonly _errors = signal<Readonly<Record<string, PluginActionError | undefined>>>({});
	private session?: MockSession;

	readonly connected = this._connected.asReadonly();
	readonly syncFailed = this._syncFailed.asReadonly();
	readonly pending = this._pending.asReadonly();
	readonly errors = this._errors.asReadonly();
	readonly activations = computed<readonly PluginActivation[]>(() =>
		this.records().filter((activation) => activation.state !== 'STOPPED')
	);

	constructor() {
		effect((onCleanup) => {
			const room = this.meetingState.lkRoom();

			if (room) {
				untracked(() => onCleanup(this.attach(room)));
			}
		});
	}

	canActivate(pluginId: string): boolean {
		return !!this.registry.find(pluginId) && pluginId !== 'restricted';
	}

	async activate(pluginId: string): Promise<void> {
		if (this.pending()[pluginId] || this.activations().some((item) => item.pluginId === pluginId)) return;

		if (!this.canActivate(pluginId)) {
			this.setError(pluginId, 'FORBIDDEN');
			return;
		}

		await this.change(pluginId, 'ACTIVE');
	}

	async stop(activationId: string): Promise<void> {
		const activation = this.activations().find((item) => item.activationId === activationId);

		if (!activation || this.pending()[activation.pluginId]) return;

		await this.change(activation.pluginId, 'STOPPED', activationId);
	}

	async refresh(): Promise<void> {
		const session = this.session;

		if (!session?.callId) return;

		try {
			await this.send(session, 'snapshot', this.records());
			await this.send(session, 'request');

			if (this.session === session) this._syncFailed.set(false);
		} catch {
			if (this.session === session) this._syncFailed.set(true);
		}
	}

	private async change(pluginId: string, state: 'ACTIVE' | 'STOPPED', requestedActivationId?: string): Promise<void> {
		const session = this.session;
		const plugin = this.registry.find(pluginId);

		if (!session || !plugin || !this.connected()) {
			this.setError(pluginId, state === 'ACTIVE' ? 'ACTIVATION_FAILED' : 'STOP_FAILED');
			return;
		}

		this._pending.update((pending) => ({ ...pending, [pluginId]: state === 'ACTIVE' ? 'ACTIVATING' : 'STOPPING' }));
		this.setError(pluginId, undefined);

		try {
			await this.registry.getManifest(pluginId, plugin.version);

			if (this.session !== session) return;

			if (state === 'ACTIVE' && pluginId === 'rejected') {
				this.setError(pluginId, 'REJECTED');
				return;
			}

			const previous = this.records().find((item) => item.pluginId === pluginId);

			if (requestedActivationId && previous?.activationId !== requestedActivationId) return;

			if (
				(state === 'ACTIVE' && previous?.state === 'ACTIVE') ||
				(state === 'STOPPED' && previous?.state !== 'ACTIVE')
			) {
				return;
			}

			const revision = (previous?.revision ?? 0) + 1;
			const activationId = state === 'ACTIVE' ? crypto.randomUUID() : previous!.activationId;
			const record: MockActivation = {
				activationId,
				callId: session.callId,
				pluginId,
				pluginVersion: plugin.version,
				registryId: this.registry.registryId,
				state,
				stateChangedAt: new Date().toISOString(),
				idempotencyKey: activationId,
				revision,
				writer: session.room.localParticipant.identity
			};
			await this.send(session, 'snapshot', [record]);

			if (this.session === session) this.merge([record]);
		} catch {
			if (this.session === session) {
				this.setError(pluginId, state === 'ACTIVE' ? 'ACTIVATION_FAILED' : 'STOP_FAILED');
			}
		} finally {
			if (this.session === session) {
				this._pending.update((pending) => ({ ...pending, [pluginId]: undefined }));
			}
		}
	}

	// ponytail: peer-replicated mock, not an authority or durable store; replace with Manager snapshots/events.
	private attach(room: Room): () => void {
		const session: MockSession = { room, callId: '' };
		this.session = session;

		const onData = (
			payload: Uint8Array,
			participant?: RemoteParticipant,
			_kind?: DataPacket_Kind,
			topic?: string
		) => {
			if (
				this.session !== session ||
				!session.callId ||
				topic !== MOCK_TOPIC ||
				!participant ||
				payload.byteLength > 12_000
			)
				return;

			try {
				const message = JSON.parse(new TextDecoder().decode(payload));

				if (message?.version !== 1 || message.callId !== session.callId) return;

				if (message.type === 'request') {
					void this.send(session, 'snapshot', this.records(), participant.identity).catch(() =>
						this._syncFailed.set(true)
					);
				} else if (message.type === 'snapshot' && Array.isArray(message.items) && message.items.length <= 64) {
					if (message.items.every((item: unknown) => this.isRecord(item, session.callId))) {
						this.merge(message.items);
					}
				}
			} catch {
				// Malformed peer data cannot interrupt the call.
			}
		};

		const onConnection = () => {
			this._connected.set(
				!!session.callId &&
					room.state === ConnectionState.Connected &&
					room.localParticipant.permissions?.canPublishData !== false
			);
		};

		const synchronize = async () => {
			try {
				const callId = await room.getSid();

				if (this.session !== session) return;

				if (session.callId && session.callId !== callId) this.records.set([]);

				session.callId = callId;
				onConnection();
				await this.refresh();
			} catch {
				if (this.session === session) this._syncFailed.set(true);
			}
		};

		room.on(RoomEvent.DataReceived, onData);
		room.on(RoomEvent.ConnectionStateChanged, onConnection);
		room.on(RoomEvent.Reconnected, synchronize);
		void synchronize();

		return () => {
			room.off(RoomEvent.DataReceived, onData);
			room.off(RoomEvent.ConnectionStateChanged, onConnection);
			room.off(RoomEvent.Reconnected, synchronize);
			this.session = undefined;
			this.records.set([]);
			this._pending.set({});
			this._errors.set({});
			this._connected.set(false);
			this._syncFailed.set(false);
		};
	}

	private async send(
		session: MockSession,
		type: 'request' | 'snapshot',
		items: readonly MockActivation[] = [],
		destination?: string
	): Promise<void> {
		if (this.session !== session || !session.callId || !this.connected())
			throw new Error('Plugin sync unavailable');

		const payload = new TextEncoder().encode(JSON.stringify({ version: 1, callId: session.callId, type, items }));
		let timer: ReturnType<typeof setTimeout> | undefined;

		try {
			await Promise.race([
				session.room.localParticipant.publishData(payload, {
					topic: MOCK_TOPIC,
					reliable: true,
					destinationIdentities: destination ? [destination] : undefined
				}),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error('Plugin sync timed out')), 5000);
				})
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	private merge(items: readonly MockActivation[]): void {
		const records = new Map(this.records().map((item) => [item.pluginId, item]));

		for (const item of items) {
			const previous = records.get(item.pluginId);

			if (
				!previous ||
				item.revision > previous.revision ||
				(item.revision === previous.revision && item.writer > previous.writer)
			) {
				records.set(item.pluginId, item);
			}
		}

		this.records.set([...records.values()]);
	}

	private isRecord(value: unknown, callId: string): value is MockActivation {
		if (!value || typeof value !== 'object') return false;

		const item = value as MockActivation;
		const plugin = this.registry.find(item.pluginId);
		return (
			!!plugin &&
			this.canActivate(item.pluginId) &&
			item.pluginId !== 'rejected' &&
			item.callId === callId &&
			item.registryId === this.registry.registryId &&
			item.pluginVersion === plugin.version &&
			(item.state === 'ACTIVE' || item.state === 'STOPPED') &&
			Number.isSafeInteger(item.revision) &&
			item.revision > 0 &&
			item.revision < Number.MAX_SAFE_INTEGER &&
			[item.activationId, item.idempotencyKey, item.stateChangedAt, item.writer].every(
				(field) => typeof field === 'string' && field.length > 0 && field.length <= 256
			)
		);
	}

	private setError(pluginId: string, error: PluginActionError | undefined): void {
		this._errors.update((errors) => ({ ...errors, [pluginId]: error }));
	}
}
