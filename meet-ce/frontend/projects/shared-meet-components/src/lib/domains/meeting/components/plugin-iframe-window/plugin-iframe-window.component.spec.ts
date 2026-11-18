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

	it('only creates a real iframe for an external HTTPS URL without credentials', () => {
		const fixture = TestBed.createComponent(PluginIframeWindowComponent);

		for (const url of [
			location.origin + '/plugin',
			'javascript:alert(1)',
			'https://user:secret@plugins.example.invalid'
		]) {
			fixture.componentRef.setInput('plugin', { id: 'plugin:one', title: 'Notes', url });
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
		}
	});

	it('renders the demo in a fully sandboxed iframe without an external URL', () => {
		const fixture = TestBed.createComponent(PluginIframeWindowComponent);
		fixture.componentRef.setInput('plugin', { id: 'plugin:demo', title: 'Demo', mock: true });
		fixture.detectChanges();
		const frame: HTMLIFrameElement = fixture.nativeElement.querySelector('iframe');
		expect(frame.getAttribute('sandbox')).toBe('');
		expect(frame.hasAttribute('src')).toBeFalse();
		expect(frame.srcdoc).toContain('Demo plugin is active');
	});
});
