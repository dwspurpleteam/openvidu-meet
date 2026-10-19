import { expect, test } from '@playwright/test';
import { startScreensharing, stopScreensharing, toggleCamera } from './helpers/media-controls.helper';
import { createRoomAndGetAnonymousAccessUrl, deleteRooms } from './helpers/meet-api.helper';
import { leaveMeeting, openMeeting } from './helpers/meeting-navigation.helper';

test.describe('Meeting windows', () => {
	let roomId: string;
	let accessUrl: string;

	test.beforeEach(async () => {
		const created = await createRoomAndGetAnonymousAccessUrl();
		roomId = created.room.roomId;
		accessUrl = created.accessUrl;
	});

	test.afterEach(async () => deleteRooms([roomId]));

	test('keeps four independent iframe apps alive through drag, resize, dock and reattach', async ({ page }) => {
		await openMeeting(page, accessUrl);
		const add = page.getByTestId('add-demo-plugin');

		for (let i = 0; i < 4; i++) await add.click();

		await expect(page.locator('.plugin-window iframe')).toHaveCount(4);
		await expect(add).toBeDisabled();
		const shell = page.locator('[data-window-id="plugin:demo-1"]');
		const iframe = shell.locator('iframe');
		const original = await iframe.elementHandle();
		const notes = iframe.contentFrame().locator('#notes');
		await notes.fill('Persistent notes');
		await iframe
			.contentFrame()
			.locator('body')
			.evaluate((body) => (body.dataset['incarnation'] = 'original'));
		await shell.locator('[data-window-action="placement"]').click();
		await expect(shell).toHaveClass(/OV_floating/);
		const before = (await shell.boundingBox())!;
		const resize = (await shell.locator('.resize-se').boundingBox())!;
		await page.mouse.move(resize.x + 9, resize.y + 9);
		await page.mouse.down();
		await page.mouse.move(resize.x + 69, resize.y + 49, { steps: 10 });
		await page.mouse.up();
		await expect.poll(async () => (await shell.boundingBox())!.width).toBeGreaterThan(before.width + 40);
		await expect.poll(async () => (await shell.boundingBox())!.height).toBeGreaterThan(before.height + 20);

		const handle = (await shell.locator('.window-handle').boundingBox())!;
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down();
		await page.mouse.move(handle.x + handle.width / 2 - 20, handle.y + handle.height / 2, { steps: 3 });
		await expect(page.locator('.window-dock.drop-target')).toBeVisible();
		const dock = (await page.locator('.window-dock').boundingBox())!;
		await page.mouse.move(dock.x + dock.width / 2, dock.y + 40, { steps: 10 });
		await page.mouse.up();
		await expect(shell).toBeHidden();
		expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
		await page.locator('[data-restore-window="plugin:demo-1"]').click();
		await expect(shell).toBeVisible();
		await expect(notes).toHaveValue('Persistent notes');
		await expect(iframe.contentFrame().locator('body')).toHaveAttribute('data-incarnation', 'original');
		await shell.locator('[data-window-action="placement"]').click();
		await expect(shell).not.toHaveClass(/OV_floating/);
		await expect(notes).toHaveValue('Persistent notes');

		await shell.locator('[data-window-action="placement"]').click();
		await page.setViewportSize({ width: 420, height: 600 });
		await expect(async () => {
			const bounds = (await page.locator('#layout').boundingBox())!;
			const rect = (await shell.boundingBox())!;
			expect(rect.x).toBeGreaterThanOrEqual(bounds.x - 1);
			expect(rect.y).toBeGreaterThanOrEqual(bounds.y - 1);
			expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
			expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
		}).toPass();
		await leaveMeeting(page);
		await expect(page.locator('.plugin-window iframe')).toHaveCount(0);
	});

	test('detaches remote avatars and both screen shares without duplicating audio', async ({ page }) => {
		await openMeeting(page, accessUrl, { name: 'Viewer' });
		const peer = await page.context().newPage();

		try {
			await openMeeting(peer, accessUrl, { name: 'Peer', videoEnabled: false, audioEnabled: true });
			const remote = page.locator('.remote-participant:not(.OV_screen)').first();
			await expect(remote).toBeVisible();
			await expect.poll(() => page.locator('audio').count()).toBeGreaterThan(0);
			const audioCount = await page.locator('audio').count();
			await remote.locator('[data-window-action="placement"]').click();
			await expect(remote).toHaveClass(/OV_floating/);
			await toggleCamera(peer);
			await expect(remote).toHaveClass(/OV_floating/);
			await remote.locator('[data-window-action="minimize"]').click();
			await expect(remote).toBeHidden();
			await expect(page.locator('audio')).toHaveCount(audioCount);
			await page.locator('[data-restore-window]').first().click();
			await expect(remote).toBeVisible();
			await startScreensharing(peer);

			for (const screen of [
				peer.locator('.local_participant.OV_screen'),
				page.locator('.remote-participant.OV_screen')
			]) {
				await expect(screen).toBeVisible();
				await screen.locator('[data-window-action="placement"]').click();
				await expect(screen).toHaveClass(/OV_floating/);
			}

			await stopScreensharing(peer);
			await expect(page.locator('.remote-participant.OV_screen')).toHaveCount(0);
			await peer.close();
			await expect(remote).toHaveCount(0);
			await expect(page.locator('[data-restore-window]')).toHaveCount(0);
		} finally {
			if (!peer.isClosed()) await peer.close();
		}
	});
});
