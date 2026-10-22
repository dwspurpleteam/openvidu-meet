import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MEET_ENV } from '../../../src/environment.js';
import { getHtmlWithBasePath } from '../../../src/utils/html-dynamic-base-path.utils.js';

describe('getHtmlWithBasePath', () => {
	it('exposes the base path and plugins to the frontend without letting the data close the script', () => {
		const plugins = [{ id: 'attendance', title: '</script><b>Attendance', url: 'https://plugin.example.com/' }];
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-index-'));
		const htmlPath = path.join(dir, 'index.html');
		fs.writeFileSync(htmlPath, '<html><head><base href="/" /></head><body></body></html>');
		MEET_ENV.BASE_PATH = '/meet';
		MEET_ENV.PLUGINS = JSON.stringify(plugins);

		try {
			const html = getHtmlWithBasePath(htmlPath);
			const config = /<script>window\.__OPENVIDU_MEET_CONFIG__=(.*);<\/script>/.exec(html);

			expect(html).toContain('<base href="/meet/">');
			expect(html.match(/<\/script>/g)).toHaveLength(1);
			expect(JSON.parse(config![1])).toEqual({ basePath: '/meet/', plugins });
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
