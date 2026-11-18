import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MeetRoomMemberRole } from '@openvidu-meet/typings';
import '../../../src/config/dependency-injector.config.js';
import { MEET_ENV } from '../../../src/environment.js';
import { PluginActivationService } from '../../../src/services/plugin-activation.service.js';

const managerUrl = MEET_ENV.PLUGIN_MANAGER_URL;
const mockEnabled = MEET_ENV.PLUGIN_ACTIVATION_MOCK;
const nodeEnv = process.env.NODE_ENV;
const activationId = '799f032c-0260-4b80-b9ad-7b05ab39a2cb';
const selection = { pluginId: 'notes', pluginVersion: '1.0.0' };
const configuration = {
	...selection,
	registryId: 'local',
	manifest: { name: 'Notes', frontend: { 'url-web': 'https://notes.example/' } }
};
const roomId = 'room-1';
const callId = 'RM_current';

describe('PluginActivationService', () => {
	let role: MeetRoomMemberRole;
	let sid: string;
	let service: PluginActivationService;

	beforeEach(() => {
		MEET_ENV.PLUGIN_MANAGER_URL = 'http://manager.example';
		MEET_ENV.PLUGIN_ACTIVATION_MOCK = false;
		role = MeetRoomMemberRole.MODERATOR;
		sid = callId;
		const redis = new Map<string, string>();
		const session = {
			getRoomIdFromMember: () => roomId,
			getRoomMemberPermissions: () => ({ meetingJoin: true }),
			getParticipantIdentity: () => 'participant-1'
		};
		const leader = { participantIdentity: 'participant-1', role, joinDate: 1000 };
		service = new PluginActivationService(
			...([
				session,
				{ getRoom: async () => ({ sid }) },
				{ getParticipant: async () => ({ ...leader, role }), getParticipants: async () => [leader] },
				{
					get: async (key: string) => redis.get(key),
					set: async (key: string, data: string) => redis.set(key, data)
				},
				{ withLock: async (_key: string, _ttl: number, run: () => Promise<unknown>) => run() }
			] as unknown as ConstructorParameters<typeof PluginActivationService>)
		);
	});

	afterEach(() => {
		jest.restoreAllMocks();
		MEET_ENV.PLUGIN_MANAGER_URL = managerUrl;
		MEET_ENV.PLUGIN_ACTIVATION_MOCK = mockEnabled;
		process.env.NODE_ENV = nodeEnv;
	});

	it('rejects a speaker and a stale SID before contacting Manager', async () => {
		const fetch = jest.spyOn(globalThis, 'fetch');
		role = MeetRoomMemberRole.SPEAKER;
		await expect(service.activate(roomId, callId, selection)).rejects.toMatchObject({ statusCode: 403 });
		role = MeetRoomMemberRole.MODERATOR;
		await expect(service.activate(roomId, 'RM_previous', selection)).rejects.toMatchObject({ statusCode: 404 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('retries the same trusted request after a transport failure and publishes the UI only after ACTIVE', async () => {
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(Response.json(configuration))
			.mockRejectedValueOnce(new Error('Timed out'))
			.mockResolvedValueOnce(Response.json({ activationId }, { status: 202 }))
			.mockResolvedValueOnce(
				Response.json({
					...selection,
					activationId,
					callId,
					registryId: 'local',
					state: 'ACTIVE',
					failureCode: null
				})
			);
		await expect(service.activate(roomId, callId, selection)).rejects.toMatchObject({ statusCode: 503 });
		expect(await service.activate(roomId, callId, selection)).toMatchObject({
			activationId,
			state: 'ACTIVATING',
			ui: null
		});

		expect(fetch.mock.calls[1]?.[1]?.body).toEqual(fetch.mock.calls[2]?.[1]?.body);
		expect(JSON.parse(fetch.mock.calls[2]?.[1]?.body as string)).toMatchObject({
			callId,
			requestedBy: 'participant-1',
			pluginRegistryId: 'local',
			pluginVersion: selection.pluginVersion,
			initialContext: {
				callId,
				participants: [
					{ participantIdentity: 'participant-1', role: MeetRoomMemberRole.MODERATOR, joinDate: 1000 }
				]
			}
		});
		role = MeetRoomMemberRole.SPEAKER;
		expect(await service.list(roomId, callId)).toMatchObject({
			canActivate: false,
			activations: [{ activationId, state: 'ACTIVE', ui: { title: 'Notes', url: 'https://notes.example/' } }]
		});
	});

	it('shares an explicitly enabled production demo with listeners in the same call only', async () => {
		process.env.NODE_ENV = 'production';
		MEET_ENV.PLUGIN_MANAGER_URL = '';
		MEET_ENV.PLUGIN_ACTIVATION_MOCK = true;
		const fetch = jest.spyOn(globalThis, 'fetch');
		const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
		const state = await service.list(roomId, callId);
		expect(state.mode).toBe('mock');
		const fixture = state.mockPlugin!;
		const mockSelection = { pluginId: fixture.id, pluginVersion: fixture.version };
		const started = await service.activate(roomId, callId, mockSelection);
		expect(started.state).toBe('ACTIVATING');
		expect((await service.activate(roomId, callId, mockSelection)).activationId).toBe(started.activationId);

		now.mockReturnValue(2500);
		role = MeetRoomMemberRole.SPEAKER;
		expect(await service.list(roomId, callId)).toMatchObject({
			canActivate: false,
			activations: [{ activationId: started.activationId, state: 'ACTIVE' }]
		});
		sid = 'RM_next';
		expect(await service.list(roomId, sid)).toMatchObject({ activations: [] });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('keeps the demo off unless enabled explicitly', async () => {
		process.env.NODE_ENV = 'production';
		MEET_ENV.PLUGIN_MANAGER_URL = '';
		expect(await service.list(roomId, callId)).toEqual({ mode: 'disabled', canActivate: false, activations: [] });
		await expect(service.activate(roomId, callId, selection)).rejects.toMatchObject({ statusCode: 503 });
	});

	it('keeps the demo available alongside real plugins when the Manager status request fails', async () => {
		process.env.NODE_ENV = 'production';
		MEET_ENV.PLUGIN_ACTIVATION_MOCK = true;
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(Response.json(configuration))
			.mockResolvedValueOnce(Response.json({ activationId }, { status: 202 }))
			.mockResolvedValueOnce(
				Response.json({
					...selection,
					activationId,
					callId,
					registryId: 'local',
					state: 'FAILED',
					failureCode: 'START_FAILED'
				})
			)
			.mockRejectedValueOnce(new Error('Manager offline'));
		const { mockPlugin: demo } = await service.list(roomId, callId);
		const simulated = await service.activate(roomId, callId, { pluginId: demo!.id, pluginVersion: demo!.version });
		await expect(service.activate(roomId, callId, selection)).resolves.toMatchObject({ activationId });
		expect(await service.list(roomId, callId)).toMatchObject({
			mode: 'manager',
			activations: [
				{ activationId, state: 'FAILED' },
				{ activationId: simulated.activationId, pluginId: demo!.id }
			]
		});
		expect(await service.list(roomId, callId)).toMatchObject({
			mode: 'manager',
			managerStatusUnavailable: true,
			activations: [{ activationId: simulated.activationId, pluginId: demo!.id }]
		});
		expect(fetch).toHaveBeenCalledTimes(4);
	});
});
