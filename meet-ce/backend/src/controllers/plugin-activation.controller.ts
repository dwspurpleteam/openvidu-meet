import type { Request, Response } from 'express';
import { z } from 'zod';
import { container } from '../config/dependency-injector.config.js';
import { handleError, rejectUnprocessableRequest } from '../models/error.model.js';
import { PluginActivationService } from '../services/plugin-activation.service.js';

const call = z.object({ callId: z.string().min(1).max(255) });
const identifier = z
	.string()
	.min(1)
	.max(255)
	.refine((value) => value.trim() === value && value !== '.' && value !== '..' && !/[/\\]/.test(value));
const activation = call.strict().extend({ pluginId: identifier, pluginVersion: identifier });

export const list = async (req: Request, res: Response) => {
	const query = call.safeParse(req.query);

	if (!query.success) return rejectUnprocessableRequest(res, query.error);

	try {
		const state = await container.get(PluginActivationService).list(req.params.roomId as string, query.data.callId);
		return res.set('Cache-Control', 'no-store').json(state);
	} catch (error) {
		return handleError(res, error, 'reading plugin activations');
	}
};

export const activate = async (req: Request, res: Response) => {
	const body = activation.safeParse(req.body);

	if (!body.success) return rejectUnprocessableRequest(res, body.error);

	try {
		const { callId, pluginId, pluginVersion } = body.data;
		const result = await container.get(PluginActivationService).activate(req.params.roomId as string, callId, {
			pluginId,
			pluginVersion
		});
		return res.status(202).json(result);
	} catch (error) {
		return handleError(res, error, 'registering a plugin activation');
	}
};
