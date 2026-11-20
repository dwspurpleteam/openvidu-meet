import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MeetRoomMemberRole } from '@openvidu-meet/typings';
import '../../../src/config/dependency-injector.config.js';
import { MEET_ENV } from '../../../src/environment.js';
import { PluginActivationService } from '../../../src/services/plugin-activation.service.js';

const managerUrl = MEET_ENV.PLUGIN_MANAGER_URL;
const activationId = '799f032c-0260-4b80-b9ad-7b05ab39a2cb';
const selection = { pluginId: 'attendance', pluginVersion: '1.0.1' };
const configuration = {
	...selection,
	registryId: 'local',
	manifest: {
		name: 'Attendance',
		frontend: { 'url-web': 'https://calls.example/apps/plugin-attendance/?lang=ru&callId=old&callId=stale#top' }
	}
};
const roomId = 'room-1';
const callId = 'RM_current';

describe('PluginActivationService', () => {
	let role: MeetRoomMemberRole;
	let sid: string;
	let service: PluginActivationService;

	beforeEach(() => {
		MEET_ENV.PLUGIN_MANAGER_URL = 'http://manager.example';
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
			activations: [
				{
					activationId,
					state: 'ACTIVE',
					ui: {
						title: 'Attendance',
						url: 'https://calls.example/apps/plugin-attendance/?lang=ru&callId=RM_current#top'
					}
				}
			]
		});
		sid = 'RM_next';
		expect(await service.list(roomId, sid)).toMatchObject({ activations: [] });
	});

	it('disables activation when no Manager is configured', async () => {
		MEET_ENV.PLUGIN_MANAGER_URL = '';
		expect(await service.list(roomId, callId)).toEqual({ mode: 'disabled', canActivate: false, activations: [] });
		await expect(service.activate(roomId, callId, selection)).rejects.toMatchObject({ statusCode: 503 });
	});

	it('returns the Manager failure code and reports a later status outage', async () => {
		jest.spyOn(globalThis, 'fetch')
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
		await expect(service.activate(roomId, callId, selection)).resolves.toMatchObject({ activationId });
		expect(await service.list(roomId, callId)).toMatchObject({
			mode: 'manager',
			activations: [{ activationId, state: 'FAILED', failureCode: 'START_FAILED', ui: null }]
		});
		await expect(service.list(roomId, callId)).rejects.toMatchObject({ statusCode: 503 });
	});
});
