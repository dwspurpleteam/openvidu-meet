import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PluginConfig, RuntimeConfigService } from '../../../../shared/services/runtime-config.service';
import { PanelService, Room } from '../../openvidu-components';
import { StreamLayoutStateService } from '../../openvidu-components/services/layout/stream-layout-state.service';
import { MeetingCaptionsService } from '../../services/meeting-captions.service';
import { MeetingContextService } from '../../services/meeting-context.service';
import { MeetingStateService } from '../../services/meeting-state.service';
import { RoomAccessLinkService } from '../../services/room-access-link.service';
import { MeetingCustomLayoutComponent } from './meeting-custom-layout.component';

const ATTENDANCE: PluginConfig = {
	id: 'attendance',
	title: 'Attendance',
	url: 'https://plugin.example.com/?theme=dark'
};

describe('MeetingCustomLayoutComponent plugins', () => {
	let component: MeetingCustomLayoutComponent;
	let clearWindow: jasmine.Spy;

	beforeEach(() => {
		const room = {
			name: 'team-call',
			localParticipant: { identity: 'anna-0123456789abcde' },
			getSid: () => Promise.resolve('RM_123')
		} as unknown as Room;
		clearWindow = jasmine.createSpy('clearWindow');

		TestBed.configureTestingModule({
			providers: [
				{ provide: RuntimeConfigService, useValue: { plugins: [ATTENDANCE] } },
				{ provide: MeetingStateService, useValue: { lkRoom: signal(room) } },
				{ provide: StreamLayoutStateService, useValue: { clearWindow } },
				{ provide: MeetingContextService, useValue: {} },
				{ provide: RoomAccessLinkService, useValue: {} },
				{ provide: MeetingCaptionsService, useValue: {} },
				{ provide: PanelService, useValue: {} }
			]
		});
		TestBed.overrideComponent(MeetingCustomLayoutComponent, { set: { template: '', imports: [] } });
		component = TestBed.createComponent(MeetingCustomLayoutComponent).componentInstance;
	});

	it('opens a plugin with the meeting in its URL and closes it on the next toggle', async () => {
		await component.togglePlugin(ATTENDANCE);

		expect(component.pluginWindows()).toEqual([
			{
				id: 'plugin:attendance',
				title: 'Attendance',
				url: 'https://plugin.example.com/?theme=dark&callId=RM_123&roomId=team-call&participantId=anna-0123456789abcde'
			}
		]);
		expect(component.openPluginIds()).toEqual(['attendance']);

		await component.togglePlugin(ATTENDANCE);

		expect(component.pluginWindows()).toEqual([]);
		expect(clearWindow).toHaveBeenCalledWith('plugin:attendance');
	});

	it('opens a single window when the plugin is toggled again before the first toggle settles', async () => {
		await Promise.all([component.togglePlugin(ATTENDANCE), component.togglePlugin(ATTENDANCE)]);

		expect(component.pluginWindows().length).toBe(1);
	});
});
