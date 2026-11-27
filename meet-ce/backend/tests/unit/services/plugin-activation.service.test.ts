import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MeetRoomMemberRole } from '@openvidu-meet/typings';
import express from 'express';
import request from 'supertest';
import { container } from '../../../src/config/dependency-injector.config.js';
import { MEET_ENV } from '../../../src/environment.js';
import { roomMemberTokenValidator } from '../../../src/middlewares/auth.middleware.js';
import { pluginActivationRouter } from '../../../src/routes/plugin-activation.routes.js';
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
const activeStatus = {
	...selection,
	activationId,
	callId,
	requestedVersion: selection.pluginVersion,
	requestedRegistryId: 'local',
	registryId: 'local',
	state: 'ACTIVE',
	failureCode: null
};
const deactivation = { activationId, pluginId: selection.pluginId, success: false, deactivatedAt: null };

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
				{ withRetryLock: async (_key: string, _ttl: number, run: () => Promise<unknown>) => run() }
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
		await expect(service.deactivate(roomId, callId, activationId)).rejects.toMatchObject({ statusCode: 403 });
		role = MeetRoomMemberRole.MODERATOR;
		await expect(service.activate(roomId, 'RM_previous', selection)).rejects.toMatchObject({ statusCode: 404 });
		await expect(service.deactivate(roomId, 'RM_previous', activationId)).rejects.toMatchObject({
			statusCode: 404
		});
		await expect(service.deactivate('other-room', callId, activationId)).rejects.toMatchObject({ statusCode: 403 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('forwards the moderator identity and tracks accepted and completed stops', async () => {
		const fetch = await registerActivePlugin();
		fetch
			.mockResolvedValueOnce(Response.json(deactivation, { status: 202 }))
			.mockResolvedValueOnce(Response.json({ ...activeStatus, state: 'STOPPED' }))
			.mockResolvedValueOnce(
				Response.json({ ...deactivation, success: true, deactivatedAt: 1780000000 }, { status: 202 })
			);

		expect(await service.deactivate(roomId, callId, activationId)).toEqual({
			...selection,
			activationId,
			state: 'STOPPING',
			failureCode: null,
			ui: null
		});
		expect(fetch).toHaveBeenLastCalledWith(
			new URL(`http://manager.example/v1/activations/${activationId}/deactivate`),
			expect.objectContaining({ method: 'POST', body: JSON.stringify({ requestedBy: 'participant-1' }) })
		);

		role = MeetRoomMemberRole.SPEAKER;
		expect(await service.list(roomId, callId)).toMatchObject({
			canActivate: false,
			activations: [{ activationId, state: 'STOPPED', ui: null }]
		});
		role = MeetRoomMemberRole.MODERATOR;
		expect(await service.deactivate(roomId, callId, activationId)).toMatchObject({ state: 'STOPPED', ui: null });
	});

	it('does not forward an activation from an earlier call or an unknown ID', async () => {
		const fetch = await registerActivePlugin();
		fetch.mockClear();
		await expect(service.deactivate(roomId, callId, 'bdfcec23-b508-4c18-ba64-6d4135797715')).rejects.toMatchObject({
			statusCode: 404
		});
		sid = 'RM_next';
		await expect(service.deactivate(roomId, sid, activationId)).rejects.toMatchObject({ statusCode: 404 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('reports an unavailable route or a mismatched acknowledgement and allows a retry', async () => {
		const fetch = await registerActivePlugin();
		fetch
			.mockResolvedValueOnce(new Response(null, { status: 404 }))
			.mockResolvedValueOnce(Response.json({ ...deactivation, pluginId: 'other-plugin' }, { status: 202 }))
			.mockResolvedValueOnce(Response.json(deactivation, { status: 202 }));

		await expect(service.deactivate(roomId, callId, activationId)).rejects.toMatchObject({ statusCode: 503 });
		await expect(service.deactivate(roomId, callId, activationId)).rejects.toMatchObject({ statusCode: 503 });
		await expect(service.deactivate(roomId, callId, activationId)).resolves.toMatchObject({ state: 'STOPPING' });
	});

	it('requires authentication and validates the deactivation request at the HTTP route', async () => {
		const fetch = await registerActivePlugin();
		fetch.mockClear().mockResolvedValueOnce(Response.json(deactivation, { status: 202 }));
		jest.spyOn(roomMemberTokenValidator, 'validate').mockResolvedValue(undefined);
		const app = express().use(express.json(), pluginActivationRouter);
		const path = `/${roomId}/plugin-activations/${activationId}/deactivate`;
		const withToken = (url: string) => request(app).post(url).set('x-room-member-token', 'Bearer room-token');
		container.snapshot();

		try {
			(await container.rebindAsync(PluginActivationService)).toConstantValue(service);
			await request(app).post(path).send({ callId }).expect(401);
			await withToken(path).send({ callId, requestedBy: 'spoofed' }).expect(422);
			await withToken(`/${roomId}/plugin-activations/not-a-uuid/deactivate`).send({ callId }).expect(422);
			expect(fetch).not.toHaveBeenCalled();

			const response = await withToken(path).send({ callId }).expect(202);
			expect(response.body).toMatchObject({ activationId, state: 'STOPPING', ui: null });
		} finally {
			container.restore();
		}
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
					requestedVersion: selection.pluginVersion,
					requestedRegistryId: 'local',
					registryId: null,
					pluginVersion: null,
					state: 'ACTIVATING',
					failureCode: null
				})
			)
			.mockResolvedValueOnce(
				Response.json({
					...selection,
					activationId,
					callId,
					requestedVersion: selection.pluginVersion,
					requestedRegistryId: 'local',
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

	it('uses the version of the existing activation returned by Manager', async () => {
		const existingVersion = '1.0.0';
		jest.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(Response.json(configuration))
			.mockResolvedValueOnce(Response.json({ activationId }, { status: 200 }))
			.mockResolvedValueOnce(
				Response.json({
					activationId,
					callId,
					pluginId: selection.pluginId,
					requestedVersion: existingVersion,
					requestedRegistryId: 'local',
					registryId: 'local',
					pluginVersion: existingVersion,
					state: 'ACTIVE',
					failureCode: null
				})
			)
			.mockResolvedValueOnce(Response.json({ ...configuration, pluginVersion: existingVersion }));

		expect(await service.activate(roomId, callId, selection)).toMatchObject({
			activationId,
			pluginVersion: existingVersion,
			state: 'ACTIVE'
		});
	});

	it('returns one activation to concurrent moderators', async () => {
		const redis = new Map<string, string>();
		let pending = Promise.resolve();
		let user = 0;
		const session = {
			getRoomIdFromMember: () => roomId,
			getRoomMemberPermissions: () => ({ meetingJoin: true }),
			getParticipantIdentity: () => `moderator-${++user}`
		};
		const participants = ['moderator-1', 'moderator-2'].map((participantIdentity) => ({
			participantIdentity,
			role: MeetRoomMemberRole.MODERATOR,
			joinDate: 1000
		}));
		service = new PluginActivationService(
			...([
				session,
				{ getRoom: async () => ({ sid: callId }) },
				{
					getParticipant: async (_room: string, identity: string) =>
						participants.find((item) => item.participantIdentity === identity),
					getParticipants: async () => participants
				},
				{
					get: async (key: string) => redis.get(key),
					set: async (key: string, value: string) => redis.set(key, value)
				},
				{
					withRetryLock: async (_key: string, _ttl: number, run: () => Promise<unknown>) => {
						const result = pending.then(run);
						pending = result.then(() => undefined);
						return result;
					}
				}
			] as unknown as ConstructorParameters<typeof PluginActivationService>)
		);
		const status = {
			...selection,
			activationId,
			callId,
			requestedVersion: selection.pluginVersion,
			requestedRegistryId: 'local',
			registryId: null,
			pluginVersion: null,
			state: 'ACTIVATING',
			failureCode: null
		};
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(Response.json(configuration))
			.mockResolvedValueOnce(Response.json({ activationId }, { status: 202 }))
			.mockResolvedValueOnce(Response.json(status))
			.mockResolvedValueOnce(Response.json(status));
		const results = await Promise.all([
			service.activate(roomId, callId, selection),
			service.activate(roomId, callId, { ...selection, pluginVersion: '2.0.0' })
		]);
		expect(results.map((item) => item.activationId)).toEqual([activationId, activationId]);
		expect(results.map((item) => item.pluginVersion)).toEqual([selection.pluginVersion, selection.pluginVersion]);
		expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
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
					requestedVersion: selection.pluginVersion,
					requestedRegistryId: 'local',
					registryId: null,
					pluginVersion: null,
					state: 'ACTIVATING',
					failureCode: null
				})
			)
			.mockResolvedValueOnce(
				Response.json({
					...selection,
					activationId,
					callId,
					requestedVersion: selection.pluginVersion,
					requestedRegistryId: 'local',
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

	async function registerActivePlugin() {
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(Response.json(configuration))
			.mockResolvedValueOnce(Response.json({ activationId }, { status: 202 }))
			.mockResolvedValueOnce(Response.json(activeStatus));
		await service.activate(roomId, callId, selection);
		return fetch;
	}
});
