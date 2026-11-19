import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '../../../../../../shared/services/i18n/translate.service';
import { StreamLayoutStateService } from '../../../services/layout/stream-layout-state.service';
import { WindowShellComponent } from './window-shell.component';

@Component({
	imports: [WindowShellComponent],
	template: `
		<div #bounds style="position:relative;width:600px;height:400px">
			<ov-window-shell windowId="plugin:demo" title="Transcript" [boundary]="bounds">
				<iframe title="Fixture" srcdoc="<textarea>initial</textarea>"></iframe>
			</ov-window-shell>
		</div>
	`
})
class TestHost {}

describe('WindowShellComponent', () => {
	beforeEach(() =>
		TestBed.configureTestingModule({
			imports: [TestHost],
			providers: [
				StreamLayoutStateService,
				{
					provide: TranslateService,
					useValue: { translationsLoaded: () => 0, translate: (key: string) => key }
				}
			]
		})
	);

	it('resizes both dimensions, cancels pointer gestures and supports keyboard geometry', async () => {
		const fixture = TestBed.createComponent(TestHost);
		const state = TestBed.inject(StreamLayoutStateService);
		state.setWindowRect('plugin:demo', { x: 20, y: 30, width: 250, height: 180 });
		state.setWindowMode('plugin:demo', 'floating');
		fixture.detectChanges();
		await fixture.whenStable();
		const handle = fixture.nativeElement.querySelector('.resize-se') as HTMLButtonElement;
		spyOn(handle, 'setPointerCapture');
		const pointer = (type: string, x: number, y: number) =>
			handle.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					pointerId: 1,
					button: 0,
					clientX: x,
					clientY: y
				})
			);
		pointer('pointerdown', 0, 0);
		pointer('pointermove', 60, 45);
		pointer('pointerup', 60, 45);
		expect(state.windowPlacement('plugin:demo').rect).toEqual({ x: 20, y: 30, width: 310, height: 225 });
		pointer('pointerdown', 0, 0);
		pointer('pointermove', -200, -200);
		pointer('pointercancel', -200, -200);
		expect(state.windowPlacement('plugin:demo').rect).toEqual({ x: 20, y: 30, width: 310, height: 225 });
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
		expect(state.windowPlacement('plugin:demo').rect?.width).toBe(320);
	});

	it('retains the iframe and its state through float, minimize, restore and grid, and clamps resized geometry', async () => {
		const fixture = TestBed.createComponent(TestHost);
		fixture.detectChanges();
		await fixture.whenStable();
		const element = fixture.nativeElement as HTMLElement;
		const frame = element.querySelector('iframe')!;

		if (!frame.contentDocument?.querySelector('textarea')) {
			await new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
		}

		const notes = frame.contentDocument!.querySelector('textarea')!;
		notes.value = 'keep these notes';
		const window = frame.contentWindow;
		const state = TestBed.inject(StreamLayoutStateService);

		for (const mode of ['floating', 'minimized', 'floating', 'grid'] as const) {
			state.setWindowMode('plugin:demo', mode);
			fixture.detectChanges();
			await fixture.whenStable();
			expect(element.querySelector('iframe')).toBe(frame);
			expect(frame.contentWindow).toBe(window);
			expect(frame.contentDocument!.querySelector('textarea')!.value).toBe('keep these notes');
		}

		state.setWindowRect('plugin:demo', { x: 1000, y: 1000, width: 900, height: 800 });
		state.setWindowMode('plugin:demo', 'floating');
		fixture.detectChanges();
		await fixture.whenStable();
		const shell = element.querySelector('ov-window-shell')!;
		const bounds = shell.parentElement!.getBoundingClientRect();
		const rect = shell.getBoundingClientRect();
		expect(rect.width).toBe(600);
		expect(rect.height).toBe(400);
		expect(rect.left).toBeCloseTo(bounds.left, 0);
		expect(rect.top).toBeCloseTo(bounds.top, 0);
	});
});
