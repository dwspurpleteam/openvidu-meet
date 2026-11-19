import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '../../../../../shared/services/i18n/translate.service';
import { MeetStorageService } from '../../../../../shared/services/storage.service';
import { MeetingUiConfigService } from '../../services/config/meeting-ui-config.service';
import { SmartLayoutService } from '../../services/layout/smart-layout.service';
import { StreamLayoutStateService } from '../../services/layout/stream-layout-state.service';
import { ParticipantService } from '../../services/participant/participant.service';
import { TemplateRegistryService } from '../../services/template/template-registry.service';
import { BaseLayoutComponent } from './base-layout.component';

@Component({
	imports: [BaseLayoutComponent],
	template: `<div style="width:700px;height:400px"><ov-base-layout [pluginWindows]="plugins()" /></div>`
})
class TestHost {
	readonly plugins = signal([{ id: 'plugin:fixture', title: 'Transcript', url: 'about:blank' }]);
}

describe('BaseLayoutComponent window dock', () => {
	it('drags a window by its handle into the dock and restores its pre-drag geometry without recreating the iframe', async () => {
		TestBed.configureTestingModule({
			imports: [TestHost],
			providers: [
				StreamLayoutStateService,
				{
					provide: TranslateService,
					useValue: { translationsLoaded: () => 0, translate: (key: string) => key }
				},
				{ provide: MeetStorageService, useValue: { setLocalTileFloating: () => {} } },
				{
					provide: MeetingUiConfigService,
					useValue: {
						streamVideoControlsSignal: signal(true),
						layoutRemoteParticipantsSignal: signal(undefined)
					}
				},
				{
					provide: ParticipantService,
					useValue: { localParticipant: signal(undefined), remoteParticipants: signal([]) }
				},
				{
					provide: TemplateRegistryService,
					useValue: { stream: signal(undefined), layoutAdditionalElements: signal(undefined) }
				},
				{ provide: SmartLayoutService, useValue: { initialize: () => {}, update: () => {}, clear: () => {} } }
			]
		});
		const fixture = TestBed.createComponent(TestHost);
		fixture.detectChanges();
		await fixture.whenStable();
		const element = fixture.nativeElement as HTMLElement;
		const frame = element.querySelector('iframe')!;
		const state = TestBed.inject(StreamLayoutStateService);
		const rect = { x: 30, y: 40, width: 320, height: 220 };
		state.setWindowRect('plugin:fixture', rect);
		state.setWindowMode('plugin:fixture', 'floating');
		fixture.detectChanges();
		await fixture.whenStable();
		const handle = element.querySelector('.window-handle')!;
		const box = handle.getBoundingClientRect();
		const mouse = (target: EventTarget, type: string, x: number, y: number) =>
			target.dispatchEvent(
				new MouseEvent(type, {
					bubbles: true,
					cancelable: true,
					view: window,
					detail: 1,
					button: 0,
					buttons: type === 'mouseup' ? 0 : 1,
					clientX: x,
					clientY: y
				})
			);
		mouse(handle, 'mousedown', box.x + 50, box.y + 18);
		mouse(document, 'mousemove', box.x + 80, box.y + 18);
		fixture.detectChanges();
		await fixture.whenStable();
		const dock = element.querySelector('.window-dock');
		expect(dock).not.toBeNull();

		if (!dock) return;

		const drop = dock.getBoundingClientRect();
		mouse(document, 'mousemove', drop.x + drop.width / 2, drop.y + 40);
		mouse(document, 'mouseup', drop.x + drop.width / 2, drop.y + 40);
		fixture.detectChanges();
		await fixture.whenStable();
		expect(state.windowPlacement('plugin:fixture').mode).toBe('minimized');
		expect(state.windowPlacement('plugin:fixture').rect).toEqual(rect);
		(element.querySelector('[data-restore-window]') as HTMLButtonElement).click();
		fixture.detectChanges();
		await fixture.whenStable();
		expect(state.windowPlacement('plugin:fixture').mode).toBe('floating');
		expect(element.querySelector('iframe')).toBe(frame);
		expect(element.querySelector('.window-dock')).toBeNull();

		mouse(handle, 'mousedown', box.x + 50, box.y + 18);
		mouse(document, 'mousemove', box.x + 80, box.y + 18);
		fixture.detectChanges();
		await fixture.whenStable();
		expect(element.querySelector('.drag-shield')).not.toBeNull();
		fixture.componentInstance.plugins.set([]);
		fixture.detectChanges();
		await fixture.whenStable();
		expect(element.querySelector('.drag-shield')).toBeNull();
		expect(element.querySelector('.window-dock')).toBeNull();
	});
});
