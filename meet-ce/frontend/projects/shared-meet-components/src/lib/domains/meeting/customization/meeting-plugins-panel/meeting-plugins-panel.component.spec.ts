import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslations } from '../../../../shared/models/translation-bundle.model';
import { LanguageService } from '../../../../shared/services/i18n/language.service';
import { RuntimeConfigService } from '../../../../shared/services/runtime-config.service';
import { MEETING_TRANSLATIONS } from '../../lang/meeting-translations';
import { PanelService } from '../../openvidu-components/services/panel/panel.service';
import { PluginActivationService } from '../../services/plugin-activation.service';
import { MeetingPluginsPanelComponent } from './meeting-plugins-panel.component';

describe('MeetingPluginsPanelComponent', () => {
	const registryUrl = 'https://meet.example/v1/plugins';
	const first = '1.0.0';
	const second = '2.0.0';
	let fixture: ComponentFixture<MeetingPluginsPanelComponent>;
	let http: HttpTestingController;
	let activate: jasmine.Spy<PluginActivationService['activate']>;

	beforeEach(async () => {
		activate = jasmine.createSpy('activate').and.resolveTo(true);
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(),
				provideHttpClientTesting(),
				provideTranslations(MEETING_TRANSLATIONS),
				{ provide: LanguageService, useValue: { selectedLanguage: signal({ name: 'English', lang: 'en' }) } },
				{
					provide: RuntimeConfigService,
					useValue: { isReadyForRequests: () => true, serverBaseUrl: () => 'https://meet.example/meet' }
				},
				{ provide: PanelService, useValue: {} },
				{
					provide: PluginActivationService,
					useValue: {
						activations: () => new Map(),
						syncFailed: () => false,
						canActivate: () => true,
						isStarting: () => false,
						activate
					}
				}
			]
		});
		fixture = TestBed.createComponent(MeetingPluginsPanelComponent);
		http = TestBed.inject(HttpTestingController);
		fixture.detectChanges();
		http.expectOne(`${registryUrl}?page=1&limit=20`).flush({
			items: [
				{ id: 'notes', name: 'Notes' },
				{ id: 'summary', name: 'Summary' }
			],
			totalPages: 1
		});
		await render();
	});

	afterEach(() => http.verify());

	it('loads permissions for the only version and shows them before activation', async () => {
		const notes = row('Notes');
		await choosePlugin(notes, 'notes', [first]);
		const manifest = expectManifest('notes', first);
		expect(notes.querySelector('select')?.value).toBe(first);
		expect(notes.textContent).toContain('Loading permissions');
		expect(button(notes, 'Activate').disabled).toBeTrue();

		manifest.flush({
			'plugin-id': 'notes',
			'plugin-version': first,
			backend: {
				'initial-state': ['participants'],
				events: { 'available-event-types': ['participant.joined'] },
				media: { input: ['AUDIO'], output: ['SCREEN_SHARE'] },
				actions: ['notes.add']
			}
		});
		await render();
		expect(notes.textContent).toContain('Requested permissions');
		expect(Array.from(notes.querySelectorAll('dd li'), (item) => item.textContent?.trim())).toEqual([
			'Current participant list',
			'Participant joins',
			'Microphone audio',
			'Screen share video',
			'notes.add'
		]);
		expect(button(notes, 'Activate').disabled).toBeFalse();
		button(notes, 'Activate').click();
		expect(activate).toHaveBeenCalledOnceWith('notes', first);
	});

	it('discards late responses after switching versions or clearing the choice', async () => {
		const notes = row('Notes');
		await choosePlugin(notes, 'notes', [first, second]);
		http.expectNone((request) => request.url.endsWith('/manifest'));
		changeVersion(notes, first);
		const oldManifest = expectManifest('notes', first);
		changeVersion(notes, second);
		const newManifest = expectManifest('notes', second);
		newManifest.flush({ 'plugin-id': 'notes', 'plugin-version': second, backend: { actions: ['notes.new'] } });
		await render();
		oldManifest.flush({ 'plugin-id': 'notes', 'plugin-version': first, backend: { actions: ['notes.old'] } });
		await render();
		expect(notes.textContent).toContain('notes.new');
		expect(notes.textContent).not.toContain('notes.old');
		button(notes, 'Activate').click();
		expect(activate).toHaveBeenCalledOnceWith('notes', second);

		changeVersion(notes, first);
		const clearedManifest = expectManifest('notes', first);
		changeVersion(notes, '');
		clearedManifest.flush({ 'plugin-id': 'notes', 'plugin-version': first, backend: {} });
		await render();
		expect(notes.querySelector('.plugin-permissions')).toBeNull();
		expect(button(notes, 'Activate').disabled).toBeTrue();
	});

	it('discards a pending preview when another plugin is chosen', async () => {
		const notes = row('Notes');
		const summary = row('Summary');
		await choosePlugin(notes, 'notes', [first]);
		const oldManifest = expectManifest('notes', first);
		await choosePlugin(summary, 'summary', [first]);
		const newManifest = expectManifest('summary', first);
		oldManifest.flush({ 'plugin-id': 'notes', 'plugin-version': first, backend: { actions: ['notes.add'] } });
		await render();
		expect(notes.querySelector('.plugin-permissions')).toBeNull();
		expect(button(summary, 'Activate').disabled).toBeTrue();
		newManifest.flush({ 'plugin-id': 'summary', 'plugin-version': first, backend: {} });
		await render();
		expect(button(summary, 'Activate').disabled).toBeFalse();
	});

	it('retries the selected manifest after failure and reports a successfully loaded empty list', async () => {
		const notes = row('Notes');
		await choosePlugin(notes, 'notes', [first]);
		expectManifest('notes', first).flush(null, { status: 503, statusText: 'Service Unavailable' });
		await render();
		expect(notes.textContent).toContain('Plugin permissions could not be loaded');
		expect(button(notes, 'Activate').disabled).toBeTrue();
		button(notes, 'Try again').click();
		expectManifest('notes', first).flush({ 'plugin-id': 'notes', 'plugin-version': first, backend: {} });
		await render();
		expect(notes.textContent).toContain('No permissions declared');
		expect(button(notes, 'Activate').disabled).toBeFalse();
	});

	function row(name: string): HTMLElement {
		const element = fixture.nativeElement as HTMLElement;
		return Array.from(element.querySelectorAll('article')).find(
			(article) => article.querySelector('strong')?.textContent === name
		)!;
	}

	function button(row: HTMLElement, label: string): HTMLButtonElement {
		return Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === label)!;
	}

	async function choosePlugin(row: HTMLElement, pluginId: string, versions: string[]): Promise<void> {
		button(row, 'Choose version').click();
		http.expectOne(`${registryUrl}/${pluginId}/versions?page=1&limit=20`).flush({
			items: versions.map((version) => ({ version })),
			totalPages: 1
		});
		await render();
	}

	function changeVersion(row: HTMLElement, version: string): void {
		const select = row.querySelector('select')!;
		select.value = version;
		select.dispatchEvent(new Event('change'));
	}

	function expectManifest(pluginId: string, version: string) {
		return http.expectOne(`${registryUrl}/${pluginId}/versions/${version}/manifest`);
	}

	async function render(): Promise<void> {
		await Promise.resolve();
		await fixture.whenStable();
		fixture.detectChanges();
	}
});
