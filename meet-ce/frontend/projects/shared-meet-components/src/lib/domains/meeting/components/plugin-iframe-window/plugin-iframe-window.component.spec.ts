import { TestBed } from '@angular/core/testing';
import { PluginIframeWindowComponent } from './plugin-iframe-window.component';

describe('PluginIframeWindowComponent', () => {
	it('does not reset src when a snapshot replaces the descriptor with the same URL', () => {
		const fixture = TestBed.createComponent(PluginIframeWindowComponent);
		fixture.componentRef.setInput('plugin', { id: 'plugin:one', title: 'Notes', url: 'about:blank' });
		fixture.detectChanges();
		const frame: HTMLIFrameElement = fixture.nativeElement.querySelector('iframe');
		const src = spyOnProperty(frame, 'src', 'set').and.callThrough();
		fixture.componentRef.setInput('plugin', { id: 'plugin:one', title: 'Notes', url: 'about:blank' });
		fixture.detectChanges();
		expect(src).not.toHaveBeenCalled();
		expect(fixture.nativeElement.querySelector('iframe')).toBe(frame);
	});
});
