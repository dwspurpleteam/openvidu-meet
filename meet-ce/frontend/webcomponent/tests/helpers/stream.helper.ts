import type { Locator } from '@playwright/test';

export const readVideoFrameColors = (video: Locator): Promise<{ green: number; litNonGreen: number }> =>
	video.evaluate((element: HTMLVideoElement) => {
		if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !element.videoWidth || !element.videoHeight) {
			return { green: 0, litNonGreen: 0 };
		}

		const canvas = document.createElement('canvas');
		canvas.width = 32;
		canvas.height = 24;
		const context = canvas.getContext('2d');

		if (!context) throw new Error('Could not create a canvas context for sampling the video frame');

		context.drawImage(element, 0, 0, canvas.width, canvas.height);
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		const pixelCount = canvas.width * canvas.height;
		let green = 0;
		let litNonGreen = 0;

		// Chromium's fake camera uses saturated green, and blank video frames are black.
		for (let i = 0; i < data.length; i += 4) {
			const red = data[i];
			const greenChannel = data[i + 1];
			const blue = data[i + 2];

			if (greenChannel - Math.max(red, blue) > 40) {
				green++;
			} else if (Math.max(red, greenChannel, blue) > 64) {
				litNonGreen++;
			}
		}

		return { green: green / pixelCount, litNonGreen: litNonGreen / pixelCount };
	});
