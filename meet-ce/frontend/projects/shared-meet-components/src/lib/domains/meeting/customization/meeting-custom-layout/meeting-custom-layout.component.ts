import { Component, computed, effect, inject, OnDestroy, untracked } from '@angular/core';
import { PluginWindow } from '../../components/plugin-iframe-window/plugin-iframe-window.component';
import { StreamLayoutStateService } from '../../openvidu-components/services/layout/stream-layout-state.service';
import { PluginManagerService } from '../../services/plugin-manager.service';
import { PluginRegistryService } from '../../services/plugin-registry.service';
import { RuntimeConfigService } from '../../../../shared/services/runtime-config.service';
import { ShareRoomAccessLinkComponent } from '../../components/share-room-access-link/share-room-access-link.component';
import { OpenViduComponentsUiModule, PanelService, PanelType } from '../../openvidu-components';
import { SmartLayoutComponent } from '../../openvidu-components/components/layout/smart-layout/smart-layout.component';
import { RoomAccessLinkService } from '../../services/room-access-link.service';
import { MeetingCaptionsService } from '../../services/meeting-captions.service';
import { MeetingContextService } from '../../services/meeting-context.service';
import { MeetingStateService } from '../../services/meeting-state.service';
import { MeetingCaptionsComponent } from '../meeting-captions/meeting-captions.component';
import { MeetingWaitingPanelComponent } from '../meeting-waiting-panel/meeting-waiting-panel.component';

@Component({
	selector: 'ov-meeting-custom-layout',
	imports: [
		OpenViduComponentsUiModule,
		SmartLayoutComponent,
		ShareRoomAccessLinkComponent,
		MeetingCaptionsComponent,
		MeetingWaitingPanelComponent
	],
	templateUrl: './meeting-custom-layout.component.html',
	styleUrl: './meeting-custom-layout.component.scss'
})
export class MeetingCustomLayoutComponent implements OnDestroy {
	protected meetingContextService = inject(MeetingContextService);
	protected meetingStateService = inject(MeetingStateService);
	protected roomAccessLinkService = inject(RoomAccessLinkService);
	protected captionsService = inject(MeetingCaptionsService);
	protected panelService = inject(PanelService);
	private readonly runtimeConfigService = inject(RuntimeConfigService);
	private readonly windowState = inject(StreamLayoutStateService);
	private readonly pluginManager = inject(PluginManagerService);
	private readonly pluginRegistry = inject(PluginRegistryService);
	readonly pluginWindows = computed<readonly PluginWindow[]>(() =>
		this.pluginManager
			.activations()
			.filter((activation) => activation.state === 'ACTIVE' && this.runtimeConfigService.isReadyForRequests())
			.map((activation) => ({
				id: `plugin:${activation.activationId}`,
				title: this.pluginRegistry.find(activation.pluginId)?.name ?? activation.pluginId,
				url: this.pluginRegistry.uiUrl(activation.pluginId)
			}))
	);
	private readonly hasVisiblePlugin = computed(() =>
		this.pluginWindows().some((plugin) => this.windowState.windowPlacement(plugin.id).mode !== 'minimized')
	);

	constructor() {
		let previousIds: string[] = [];
		effect(() => {
			const ids = this.pluginWindows().map((plugin) => plugin.id);
			untracked(() =>
				previousIds.filter((id) => !ids.includes(id)).forEach((id) => this.windowState.clearWindow(id))
			);
			previousIds = ids;
		});
	}

	ngOnDestroy(): void {
		this.pluginWindows().forEach((plugin) => this.windowState.clearWindow(plugin.id));
	}

	lkRoom = this.meetingStateService.lkRoom;
	roomAccessUrl = this.roomAccessLinkService.speakerPublicLink;
	areCaptionsEnabledByUser = this.captionsService.areCaptionsEnabledByUser;
	captions = this.captionsService.captions;
	isEmbeddedMode = this.runtimeConfigService.isEmbeddedMode;
	// Title/subtitle are resolved reactively in the template via the translate pipe (see SHARE_OVERLAY);
	// only the presentation sizing lives here.
	linkOverlayConfig = {
		titleSize: 'xl' as const,
		titleWeight: 'bold' as const
	};

	/**
	 * Share/copy link overlay: standalone SPA only.
	 */
	shouldShowLinkOverlay = computed(() => {
		const hasPublicSpeakerLink = !!this.roomAccessUrl();
		return (
			!this.hasVisiblePlugin() &&
			!this.isEmbeddedMode() &&
			this.meetingContextService.meetingUI().showShareAccessLinks &&
			this.meetingStateService.isAlone() &&
			hasPublicSpeakerLink
		);
	});

	/**
	 * Waiting overlay: embedded modes (webcomponent or iframe) only, shown while alone
	 * in place of the share/copy link overlay (link sharing is handled by the host application).
	 */
	shouldShowWaitingOverlay = computed(
		() => !this.hasVisiblePlugin() && this.isEmbeddedMode() && this.meetingStateService.isAlone()
	);

	/** True when either overlay covers the layout (used to hide the hidden-participants indicator). */
	shouldShowOverlay = computed(() => this.shouldShowLinkOverlay() || this.shouldShowWaitingOverlay());

	showLayoutSelector = computed(() => this.meetingContextService.meetingUI().showLayoutSelector);

	protected onCopyRoomAccessLinkClicked(): void {
		this.roomAccessLinkService.copyRoomAccessLink();
	}

	protected toggleParticipantsPanel(): void {
		this.panelService.togglePanel(PanelType.PARTICIPANTS);
	}
}
