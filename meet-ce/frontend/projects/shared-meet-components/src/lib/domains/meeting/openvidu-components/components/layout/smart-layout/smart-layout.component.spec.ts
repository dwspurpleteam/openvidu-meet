import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ParticipantModel, ParticipantStream } from '../../../models/participant.model';
import { SmartLayoutService } from '../../../services/layout/smart-layout.service';
import { StreamLayoutStateService } from '../../../services/layout/stream-layout-state.service';
import { HiddenCameraPause } from '../../../services/livekit/hidden-camera-pause';
import { ParticipantService } from '../../../services/participant/participant.service';
import { SmartLayoutComponent } from './smart-layout.component';

describe('SmartLayoutComponent window visibility', () => {
	it('refills grid slots while detached cameras survive rotation, pauses only invisible video and keeps audio single', async () => {
		const state = new StreamLayoutStateService();
		const priority = signal(['a', 'b', 'c']);
		const audio = { attach: jasmine.createSpy('attach'), detach: jasmine.createSpy('detach') };
		const cameras = new Map<string, object>();
		const participants = ['a', 'b', 'c'].map((identity) => {
			const camera = { identity };
			cameras.set(identity, camera);
			return {
				identity,
				name: identity,
				streams: computed(
					() =>
						[
							{
								streamId: `camera-${identity}`,
								source: 'camera',
								isCameraStream: true,
								isScreenStream: false,
								isFloating: state.isStreamFloating(`camera-${identity}`),
								videoTrack: { track: camera },
								audioTrack: identity === 'a' ? { track: audio } : undefined
							}
						] as unknown as ParticipantStream[]
				)
			} as unknown as ParticipantModel;
		});
		const pause = spyOn(HiddenCameraPause.prototype, 'pauseOnly');
		TestBed.configureTestingModule({
			imports: [SmartLayoutComponent],
			providers: [
				{ provide: StreamLayoutStateService, useValue: state },
				{
					provide: ParticipantService,
					useValue: { remoteParticipants: signal(participants), localParticipant: signal(undefined) }
				},
				{
					provide: SmartLayoutService,
					useValue: {
						isSmartLayoutEnabled: () => true,
						computeParticipantsToDisplay: (available: Set<string>) =>
							new Set(
								priority()
									.filter((id) => available.has(id))
									.slice(0, 1)
							),
						setRailHiddenParticipants: () => {},
						removeDisconnectedSpeakers: () => {},
						MAX_VISIBLE_REMOTE_PARTICIPANTS_LIMIT: 6
					}
				}
			]
		}).overrideComponent(SmartLayoutComponent, {
			set: { imports: [], template: '<div #audioContainer hidden></div>' }
		});
		const fixture = TestBed.createComponent(SmartLayoutComponent);
		fixture.detectChanges();
		await fixture.whenStable();
		expect(fixture.componentInstance.visibleRemoteStreams().map((s) => s.streamId)).toEqual(['camera-a']);
		state.setWindowMode('camera-a', 'floating');
		fixture.detectChanges();
		await fixture.whenStable();
		expect(fixture.componentInstance.visibleRemoteStreams().map((s) => s.streamId)).toEqual([
			'camera-b',
			'camera-a'
		]);
		priority.set(['c', 'b', 'a']);
		fixture.detectChanges();
		await fixture.whenStable();
		expect(fixture.componentInstance.visibleRemoteStreams().map((s) => s.streamId)).toEqual([
			'camera-c',
			'camera-a'
		]);
		expect(pause.calls.mostRecent().args[0]).not.toContain(cameras.get('a'));
		state.setWindowMode('camera-a', 'minimized');
		fixture.detectChanges();
		await fixture.whenStable();
		expect(fixture.componentInstance.visibleRemoteStreams().map((s) => s.streamId)).toContain('camera-a');
		expect(pause.calls.mostRecent().args[0]).toContain(cameras.get('a'));
		expect(audio.attach).toHaveBeenCalledTimes(1);
		expect(fixture.nativeElement.querySelectorAll('audio').length).toBe(1);
		fixture.destroy();
		expect(audio.detach).toHaveBeenCalledTimes(1);
	});
});
