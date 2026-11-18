import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, effect, inject, Service, signal } from '@angular/core';
import { exhaustMap, lastValueFrom, timer } from 'rxjs';
import { HTTP_HEADERS } from '../../../shared/constants/http-headers.constants';
import { HttpService } from '../../../shared/services/http.service';
import { RuntimeConfigService } from '../../../shared/services/runtime-config.service';
import { RoomMemberContextService } from '../../room-members/services/room-member-context.service';
import {
	getPluginIframeUrl,
	type PluginWindow
} from '../components/plugin-iframe-window/plugin-iframe-window.component';
import { StreamLayoutStateService } from '../openvidu-components/services/layout/stream-layout-state.service';
import { RoomEvent, type Room } from '../openvidu-components/services/livekit';
import { MeetingStateService } from './meeting-state.service';

type ActivationState =
	'ACTIVATING' | 'ACTIVE' | 'FAILED' | 'DEGRADED' | 'SUSPENDING' | 'SUSPENDED' | 'RESUMING' | 'STOPPING' | 'STOPPED';

interface Activation {
	activationId: string;
	pluginId: string;
	pluginVersion: string;
	state: ActivationState;
	failureCode: string | null;
	ui: { title: string; url: string } | null;
}

interface Snapshot {
	mode: 'disabled' | 'manager' | 'mock';
	canActivate: boolean;
	activations: Activation[];
	mockPlugin?: { id: string; version: string; name: string };
	managerStatusUnavailable?: boolean;
}

interface Call {
	room: Room;
	callId: string;
	path: string;
}

@Service()
export class PluginActivationService {
	private readonly http = inject(HttpClient);
	private readonly currentRoom = inject(MeetingStateService).lkRoom;
	private readonly runtime = inject(RuntimeConfigService);
	private readonly member = inject(RoomMemberContextService);
	private readonly hasToken = computed(() => !!this.member.roomMemberToken());
	private readonly layout = inject(StreamLayoutStateService);
	private readonly call = signal<Call | null>(null);
	private readonly snapshot = signal<Snapshot | null>(null);
	private readonly pending = signal(new Set<string>());
	private readonly failedSync = signal(false);
	private revision = 0;

	readonly mode = computed(() => this.snapshot()?.mode ?? 'disabled');
	readonly canActivate = computed(() => this.snapshot()?.canActivate ?? false);
	readonly mockPlugin = computed(() => this.snapshot()?.mockPlugin);
	readonly syncFailed = this.failedSync.asReadonly();
	readonly activations = computed(() => new Map(this.snapshot()?.activations.map((item) => [item.pluginId, item])));
	readonly windows = computed(() => {
		const windows: PluginWindow[] = [];

		for (const item of this.activations().values()) {
			if (item.state !== 'ACTIVE') continue;

			const id = 'plugin:' + item.activationId;
			const mock = this.mockPlugin();

			if (mock?.id === item.pluginId) {
				windows.push({ id, title: mock.name, mock: true });
			} else if (item.ui && getPluginIframeUrl(item.ui.url)) {
				windows.push({ id, ...item.ui });
			}
		}

		return windows;
	});

	constructor() {
		effect((onCleanup) => {
			const room = this.currentRoom();

			if (!room || !this.runtime.isReadyForRequests() || !this.hasToken()) return;

			let disposed = false;
			let disconnected = false;

			const onConnected = () => {
				disconnected = false;
			};

			const onDisconnected = () => {
				disconnected = true;
				this.clear();
			};

			room.on(RoomEvent.Disconnected, onDisconnected);
			room.on(RoomEvent.Connected, onConnected);
			const subscription = timer(0, 5000)
				.pipe(
					exhaustMap(() =>
						this.refresh(room, () => !disposed && !disconnected && this.currentRoom() === room)
					)
				)
				.subscribe();
			onCleanup(() => {
				disposed = true;
				room.off(RoomEvent.Disconnected, onDisconnected);
				room.off(RoomEvent.Connected, onConnected);
				subscription.unsubscribe();
				this.clear();
			});
		});
	}

	isStarting(pluginId: string): boolean {
		return this.pending().has(pluginId);
	}

	hasWindow(activationId: string): boolean {
		return this.windows().some(({ id }) => id === 'plugin:' + activationId);
	}

	async activate(pluginId: string, pluginVersion: string): Promise<boolean> {
		const call = this.call();

		if (!call || !this.canActivate() || this.isStarting(pluginId) || this.currentRoom() !== call.room) return false;

		this.pending.update((current) => new Set(current).add(pluginId));

		try {
			const activation = await lastValueFrom(
				this.http.post<Activation>(
					this.runtime.resolveUrl(call.path),
					{ callId: call.callId, pluginId, pluginVersion },
					this.httpOptions()
				)
			);

			if (this.call() === call && this.currentRoom() === call.room) {
				this.revision++;
				const current = this.snapshot();

				if (current)
					this.apply({
						...current,
						activations: [...current.activations.filter((item) => item.pluginId !== pluginId), activation]
					});
			}

			return true;
		} catch {
			return false;
		} finally {
			if (this.call() === call) {
				this.pending.update((current) => {
					const next = new Set(current);
					next.delete(pluginId);
					return next;
				});
			}
		}
	}

	private async refresh(room: Room, current: () => boolean): Promise<void> {
		try {
			if (!current()) return;

			const callId = await room.getSid();

			if (!current() || !callId) return;

			let call = this.call();

			if (call?.callId !== callId || call.room !== room) {
				this.clear();
				const path =
					HttpService.INTERNAL_API_PATH_PREFIX +
					'/rooms/' +
					encodeURIComponent(room.name) +
					'/plugin-activations';
				call = { room, callId, path };
				this.call.set(call);
			}

			if (this.snapshot()?.mode === 'disabled') return;

			const revision = this.revision;
			const snapshot = await lastValueFrom(
				this.http.get<Snapshot>(this.runtime.resolveUrl(call.path), {
					...this.httpOptions(),
					params: { callId }
				})
			);

			if (current() && this.call() === call && this.revision === revision) {
				if (snapshot.managerStatusUnavailable) {
					const demoId = snapshot.mockPlugin?.id;
					const retained = this.snapshot()?.activations.filter((item) => item.pluginId !== demoId) ?? [];
					snapshot.activations = [...retained, ...snapshot.activations];
				}

				this.apply(snapshot);
				this.failedSync.set(!!snapshot.managerStatusUnavailable);
			}
		} catch (error) {
			if (!current()) return;

			if (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status)) this.apply(null);

			this.failedSync.set(true);
		}
	}

	private apply(snapshot: Snapshot | null): void {
		const previous = this.windows();
		this.snapshot.set(snapshot);
		const retained = new Set(this.windows().map(({ id }) => id));

		for (const { id } of previous) {
			if (!retained.has(id)) this.layout.clearWindow(id);
		}
	}

	private httpOptions() {
		return {
			headers: { [HTTP_HEADERS.ROOM_MEMBER_TOKEN]: 'Bearer ' + this.member.roomMemberToken() },
			timeout: 15000
		};
	}

	private clear(): void {
		this.call.set(null);
		this.pending.set(new Set());
		this.failedSync.set(false);
		this.apply(null);
	}
}
