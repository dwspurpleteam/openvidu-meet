import { TestBed } from '@angular/core/testing';
import { PluginIframeWindowComponent } from './plugin-iframe-window.component';

describe('PluginIframeWindowComponent', () => {
	it('does not reset src when a snapshot replaces the descriptor with the same URL', () => {
		const fixture = TestBed.createComponent(PluginIframeWindowComponent);
		const plugin = { id: 'plugin:one', title: 'Notes', url: 'https://plugins.example.invalid/notes' };
		fixture.componentRef.setInput('plugin', plugin);
		fixture.detectChanges();
		const frame: HTMLIFrameElement = fixture.nativeElement.querySelector('iframe');
		const src = spyOnProperty(frame, 'src', 'set').and.callThrough();
		fixture.componentRef.setInput('plugin', { ...plugin });
		fixture.detectChanges();
		expect(src).not.toHaveBeenCalled();
		expect(fixture.nativeElement.querySelector('iframe')).toBe(frame);
	});

	it('rejects URLs without HTTPS or with credentials', () => {
		const fixture = TestBed.createComponent(PluginIframeWindowComponent);

		for (const url of [
			'http://plugins.example.invalid/notes',
			'javascript:alert(1)',
			'https://user:secret@plugins.example.invalid'
		]) {
			fixture.componentRef.setInput('plugin', { id: 'plugin:one', title: 'Notes', url });
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
		}
	});

	it('renders an HTTPS plugin iframe with scripts and an opaque origin', () => {
		const fixture = TestBed.createComponent(PluginIframeWindowComponent);
		const url = 'https://calls.example.invalid/apps/plugin-attendance/?callId=RM_one';
		fixture.componentRef.setInput('plugin', { id: 'plugin:one', title: 'Attendance', url });
		fixture.detectChanges();
		const frame: HTMLIFrameElement = fixture.nativeElement.querySelector('iframe');
		expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
		expect(frame.referrerPolicy).toBe('no-referrer');
		expect(frame.src).toBe(url);
	});
});
