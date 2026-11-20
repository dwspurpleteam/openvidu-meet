import { MeetRoomMemberRole } from '@openvidu-meet/typings';
import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import ms from 'ms';
import { z } from 'zod';
import { MEET_ENV } from '../environment.js';
import { errorInsufficientPermissions, errorNoActiveMeeting, OpenViduMeetError } from '../models/error.model.js';
import { RedisKeyName, RedisLockName, RedisLockPrefix } from '../models/redis.model.js';
import { LiveKitService } from './livekit.service.js';
import { MeetingService } from './meeting.service.js';
import { MutexService } from './mutex.service.js';
import { RedisService } from './redis.service.js';
import { RequestSessionService } from './request-session.service.js';

const activationStates = z.enum([
	'ACTIVATING',
	'ACTIVE',
	'FAILED',
	'DEGRADED',
	'SUSPENDING',
	'SUSPENDED',
	'RESUMING',
	'STOPPING',
	'STOPPED'
]);
const registrationSchema = z.object({ activationId: z.uuid() });
const statusSchema = registrationSchema.extend({
	callId: z.string(),
	pluginId: z.string(),
	pluginVersion: z.string().nullable(),
	registryId: z.string().nullable(),
	state: activationStates,
	failureCode: z.string().nullable()
});
const configurationSchema = z.object({
	pluginId: z.string(),
	pluginVersion: z.string(),
	registryId: z.string().min(1),
	manifest: z.object({
		name: z.string().min(1),
		frontend: z.object({ 'url-web': z.string() })
	})
});

const storageTtl = ms('32 days');

type State = z.infer<typeof activationStates>;
type Ui = { title: string; url: string } | null;
type Selection = { pluginId: string; pluginVersion: string };
type ManagerRequest = Selection & {
	callId: string;
	pluginRegistryId: string;
	requestedBy: string;
	idempotencyKey: string;
	initialContext: {
		callId: string;
		participantCount: number;
		participants: { participantIdentity: string; role: MeetRoomMemberRole; joinDate: number }[];
		snapshot: { capturedAt: string; source: string; consistency: 'partial' };
	};
};
type Draft = Selection & { ui: Ui; request: ManagerRequest };
type Registration = Selection & { ui: Ui; activationId: string; registryId: string };
type StoredActivation = Draft | Registration;
type ActivationView = Selection & {
	activationId: string;
	state: State;
	failureCode: string | null;
	ui: Ui;
};
type ActivationSnapshot = {
	mode: 'disabled' | 'manager';
	canActivate: boolean;
	activations: ActivationView[];
};

@injectable()
export class PluginActivationService {
	constructor(
		@inject(RequestSessionService) private readonly session: RequestSessionService,
		@inject(LiveKitService) private readonly livekit: LiveKitService,
		@inject(MeetingService) private readonly meetings: MeetingService,
		@inject(RedisService) private readonly redis: RedisService,
		@inject(MutexService) private readonly mutex: MutexService
	) {}

	async list(roomId: string, callId: string): Promise<ActivationSnapshot> {
		const identity = this.requireRoomMember(roomId);

		if (!MEET_ENV.PLUGIN_MANAGER_URL) return { mode: 'disabled', canActivate: false, activations: [] };

		const participant = await this.getParticipant(roomId, callId, identity);
		const stored = await this.read(this.storageKey(callId));
		const registrations = stored.filter((item): item is Registration => 'activationId' in item);
		return {
			mode: 'manager',
			canActivate: participant.role === MeetRoomMemberRole.MODERATOR,
			activations: await Promise.all(registrations.map((item) => this.status(callId, item)))
		};
	}

	async activate(roomId: string, callId: string, selection: Selection): Promise<ActivationView> {
		const identity = this.requireRoomMember(roomId);

		if (!MEET_ENV.PLUGIN_MANAGER_URL) {
			throw new OpenViduMeetError('Service Unavailable', 'Plugin activation is disabled', 503);
		}

		const participant = await this.getParticipant(roomId, callId, identity);

		if (participant.role !== MeetRoomMemberRole.MODERATOR) throw errorInsufficientPermissions();

		const key = this.storageKey(callId);
		const lock = RedisLockPrefix.BASE + RedisLockName.PLUGIN_ACTIVATIONS + ':manager:' + callId;
		const view = await this.mutex.withLock(lock, ms('30s'), async () => {
			const items = await this.read(key);
			const previous = items.find((item) => item.pluginId === selection.pluginId);
			const others = items.filter((item) => item.pluginId !== selection.pluginId);

			if (previous && 'activationId' in previous) {
				const existing = await this.status(callId, previous);

				if (existing.state !== 'FAILED' && existing.state !== 'STOPPED') return existing;
			}

			const draft =
				previous && 'request' in previous ? previous : await this.prepare(roomId, callId, identity, selection);

			if (draft.pluginVersion !== selection.pluginVersion) {
				throw new OpenViduMeetError('Conflict', 'Retry the pending registration with the same version', 409);
			}

			// Save the exact request before sending it so a timeout or crash can be retried idempotently.
			await this.save(key, [...others, draft]);
			const { activationId } = await this.managerRequest('/v1/activations', registrationSchema, {
				method: 'POST',
				body: JSON.stringify(draft.request)
			});
			const registration = {
				...selection,
				activationId,
				ui: draft.ui,
				registryId: draft.request.pluginRegistryId
			};
			await this.save(key, [...others, registration]);
			return this.view(registration, callId, 'ACTIVATING', null);
		});

		if (!view) throw new OpenViduMeetError('Conflict', 'A plugin registration is already in progress', 409);

		return view;
	}

	private requireRoomMember(roomId: string): string {
		const identity = this.session.getParticipantIdentity();

		if (
			this.session.getRoomIdFromMember() !== roomId ||
			!this.session.getRoomMemberPermissions()?.meetingJoin ||
			!identity
		) {
			throw errorInsufficientPermissions();
		}

		return identity;
	}

	private async getParticipant(roomId: string, callId: string, identity: string) {
		const [room, participant] = await Promise.all([
			this.livekit.getRoom(roomId),
			this.meetings.getParticipant(roomId, identity)
		]);

		if (room.sid !== callId) throw errorNoActiveMeeting(roomId);

		return participant;
	}

	private async prepare(roomId: string, callId: string, identity: string, selection: Selection): Promise<Draft> {
		const plugin = encodeURIComponent(selection.pluginId);
		const version = encodeURIComponent(selection.pluginVersion);
		const configuration = await this.managerRequest(
			'/v1/plugins/' + plugin + '/versions/' + version + '/configuration',
			configurationSchema
		);

		if (configuration.pluginId !== selection.pluginId || configuration.pluginVersion !== selection.pluginVersion) {
			throw this.managerUnavailable();
		}

		const participants = (await this.meetings.getParticipants(roomId)).map(
			({ participantIdentity, role, joinDate }) => ({
				participantIdentity,
				role,
				joinDate
			})
		);
		const actor = participants.find((participant) => participant.participantIdentity === identity);
		const room = await this.livekit.getRoom(roomId);

		if (!actor || actor.role !== MeetRoomMemberRole.MODERATOR) throw errorInsufficientPermissions();

		if (room.sid !== callId) throw errorNoActiveMeeting(roomId);

		return {
			...selection,
			ui: { url: configuration.manifest.frontend['url-web'], title: configuration.manifest.name },
			request: {
				...selection,
				callId,
				requestedBy: identity,
				pluginRegistryId: configuration.registryId,
				idempotencyKey: randomUUID(),
				initialContext: {
					callId,
					participantCount: participants.length,
					participants,
					snapshot: { capturedAt: new Date().toISOString(), source: 'call-backend', consistency: 'partial' }
				}
			}
		};
	}

	private async status(callId: string, item: Registration): Promise<ActivationView> {
		const status = await this.managerRequest('/v1/activations/' + item.activationId, statusSchema);

		if (
			status.activationId !== item.activationId ||
			status.callId !== callId ||
			status.pluginId !== item.pluginId ||
			(status.pluginVersion !== null && status.pluginVersion !== item.pluginVersion) ||
			(status.registryId !== null && status.registryId !== item.registryId) ||
			(status.state === 'ACTIVE' && (!status.registryId || !status.pluginVersion))
		) {
			throw this.managerUnavailable();
		}

		return this.view(item, callId, status.state, status.failureCode);
	}

	private view(item: Registration, callId: string, state: State, failureCode: string | null): ActivationView {
		return {
			pluginId: item.pluginId,
			pluginVersion: item.pluginVersion,
			activationId: item.activationId,
			state,
			failureCode,
			ui: state === 'ACTIVE' ? this.pluginUi(item.ui, callId) : null
		};
	}

	private pluginUi(ui: Ui, callId: string): Ui {
		if (!ui) return null;

		try {
			const url = new URL(ui.url);

			if (url.protocol !== 'https:' || url.username || url.password) return null;

			url.searchParams.set('callId', callId);
			return { ...ui, url: url.href };
		} catch {
			return null;
		}
	}

	private async managerRequest<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
		try {
			const response = await fetch(new URL(path, MEET_ENV.PLUGIN_MANAGER_URL), {
				...init,
				headers: { Accept: 'application/json', ...(init?.body && { 'Content-Type': 'application/json' }) },
				redirect: 'error',
				signal: AbortSignal.timeout(5000)
			});

			if (!response.ok) throw this.managerUnavailable();

			return schema.parse(await response.json());
		} catch {
			throw this.managerUnavailable();
		}
	}

	private managerUnavailable(): OpenViduMeetError {
		return new OpenViduMeetError('Service Unavailable', 'Plugin Manager did not return a valid response', 503);
	}

	private storageKey(callId: string): string {
		return RedisKeyName.PLUGIN_ACTIVATIONS + 'manager:' + callId;
	}

	private async read(key: string): Promise<StoredActivation[]> {
		const stored = await this.redis.get(key);
		return stored ? (JSON.parse(stored) as StoredActivation[]) : [];
	}

	private async save(key: string, stored: StoredActivation[]): Promise<void> {
		await this.redis.set(key, JSON.stringify(stored), storageTtl);
	}
}
