import { Router } from 'express';
import * as pluginActivationCtrl from '../controllers/plugin-activation.controller.js';
import { roomMemberTokenValidator, withAuth } from '../middlewares/auth.middleware.js';
import { apiLimiter } from '../middlewares/rate-limit.middleware.js';
import { withValidRoomId } from '../middlewares/request-validators/room-validator.middleware.js';

export const pluginActivationRouter: Router = Router();

const path = '/:roomId/plugin-activations';
pluginActivationRouter.get(
	path,
	apiLimiter,
	withAuth(roomMemberTokenValidator),
	withValidRoomId,
	pluginActivationCtrl.list
);
pluginActivationRouter.post(
	path,
	apiLimiter,
	withAuth(roomMemberTokenValidator),
	withValidRoomId,
	pluginActivationCtrl.activate
);
pluginActivationRouter.post(
	path + '/:activationId/deactivate',
	apiLimiter,
	withAuth(roomMemberTokenValidator),
	withValidRoomId,
	pluginActivationCtrl.deactivate
);
