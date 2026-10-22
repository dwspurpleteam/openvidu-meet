import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { parsePlugins } from '../../../src/utils/plugin.utils.js';

const ATTENDANCE = { id: 'attendance', title: 'Attendance', url: 'https://plugin.example.com/' };

describe('parsePlugins', () => {
	beforeEach(() => {
		jest.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('returns no plugins when MEET_PLUGINS is empty', () => {
		expect(parsePlugins('')).toEqual([]);
		expect(parsePlugins('  ')).toEqual([]);
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('returns the configured plugin pages', () => {
		const quiz = { id: 'quiz-2', title: 'Quiz', url: 'http://localhost:8082/quiz/' };

		expect(parsePlugins(JSON.stringify([ATTENDANCE, quiz]))).toEqual([ATTENDANCE, quiz]);
	});

	it.each([
		['malformed JSON', '[{'],
		['a single object instead of an array', JSON.stringify(ATTENDANCE)],
		['a URL that is not HTTP', JSON.stringify([{ ...ATTENDANCE, url: 'javascript:alert(1)' }])],
		['an id that is not a slug', JSON.stringify([{ ...ATTENDANCE, id: 'Attendance!' }])],
		['a blank title', JSON.stringify([{ ...ATTENDANCE, title: ' ' }])],
		['duplicate ids', JSON.stringify([ATTENDANCE, ATTENDANCE])]
	])('ignores the whole value with a warning on %s', (_description, value) => {
		expect(parsePlugins(value)).toEqual([]);
		expect(console.warn).toHaveBeenCalledTimes(1);
	});
});
