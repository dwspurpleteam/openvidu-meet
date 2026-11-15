import { expect, test } from '@playwright/test';
import { startScreensharing, stopScreensharing, toggleCamera } from './helpers/media-controls.helper';
import { createRoomAndGetAnonymousAccessUrl, deleteRooms } from './helpers/meet-api.helper';
import { openMeeting } from './helpers/meeting-navigation.helper';

test.describe('Meeting windows', () => {
	let roomId: string;
	let accessUrl: string;

	test.beforeEach(async () => {
		const created = await createRoomAndGetAnonymousAccessUrl();
		roomId = created.room.roomId;
		accessUrl = created.accessUrl;
	});

	test.afterEach(async () => deleteRooms([roomId]));

	test('loads all pages from the plugin registry and retries a failed request', async ({ page }) => {
		let fail = true;
		await page.route('**/v1/plugins?*', async (route) => {
			if (fail) {
				await route.fulfill({ status: 503 });
				return;
			}

			const pageNumber = new URL(route.request().url()).searchParams.get('page');
			await route.fulfill({
				json: {
					items:
						pageNumber === '1'
							? [{ id: 'first', name: 'First plugin', description: 'First description' }]
							: [{ id: 'second', name: 'Second plugin', description: 'Second description' }],
					page: Number(pageNumber),
					limit: 20,
					totalItems: 2,
					totalPages: 2
				}
			});
		});

		await openMeeting(page, accessUrl);
		await page.getByTestId('plugins-button').click();
		const panel = page.locator('#plugins-container');
		await expect(panel.getByText('The plugin catalog is unavailable.')).toBeVisible();
		fail = false;
		await panel.getByRole('button', { name: 'Try again' }).click();
		await expect(panel.getByText('First plugin')).toBeVisible();
		await expect(panel.getByText('Second plugin')).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Unavailable' })).toHaveCount(2);
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
