import { NgTemplateOutlet } from '@angular/common';
import {
	AfterViewInit,
	Component,
	computed,
	contentChild,
	contentChildren,
	effect,
	ElementRef,
	inject,
	input,
	OnDestroy,
	TemplateRef,
	untracked,
	viewChild,
	viewChildren,
	ViewContainerRef
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MeetStorageService } from '../../../../../shared/services/storage.service';
import {
	PluginIframeWindowComponent,
	PluginWindow
} from '../../../components/plugin-iframe-window/plugin-iframe-window.component';
import { LayoutAdditionalElementsDirective } from '../../directives/template/internals.directive';
import { ParticipantStream } from '../../models/participant.model';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { MeetingUiConfigService } from '../../services/config/meeting-ui-config.service';
import { SmartLayoutService } from '../../services/layout/smart-layout.service';
import { StreamLayoutStateService } from '../../services/layout/stream-layout-state.service';
import { ParticipantService } from '../../services/participant/participant.service';
import { TemplateRegistryService } from '../../services/template/template-registry.service';
import { StreamComponent } from '../stream/stream.component';
import { WindowShellComponent } from './window-shell/window-shell.component';

@Component({
	selector: 'ov-base-layout',
	imports: [
		StreamComponent,
		NgTemplateOutlet,
		WindowShellComponent,
		PluginIframeWindowComponent,
		MatIconModule,
		MatTooltipModule,
		TranslatePipe
	],
	templateUrl: './base-layout.component.html',
	styleUrls: ['./base-layout.component.scss'],
	host: { style: 'display: block; height: 100%; min-height: 0' }
})
export class BaseLayoutComponent implements OnDestroy, AfterViewInit {
	private readonly layoutService = inject(SmartLayoutService);
	private readonly participantService = inject(ParticipantService);
	private readonly directiveService = inject(MeetingUiConfigService);
	private readonly templateRegistry = inject(TemplateRegistryService);
	private readonly storage = inject(MeetStorageService);
	readonly windowState = inject(StreamLayoutStateService);
	readonly streamTemplateQuery = contentChild('stream', { read: TemplateRef });
	readonly layoutAdditionalElementsDirectives = contentChildren(LayoutAdditionalElementsDirective);
	readonly layoutContainer = viewChild('layout', { read: ViewContainerRef });
	readonly defaultStreamTemplate = viewChild<TemplateRef<any>>('defaultStream');
	readonly windows = viewChildren(WindowShellComponent);
	private readonly dock = viewChild<ElementRef<HTMLElement>>('dock');
	readonly externalAdditionalElements = input<readonly LayoutAdditionalElementsDirective[]>([]);
	readonly pluginWindows = input<readonly PluginWindow[]>([]);
	readonly controlsVisible = this.directiveService.streamVideoControlsSignal;
	readonly dragging = computed(() => this.windows().some((window) => window.isDragging()));

	readonly streamTemplate = computed(
		() => this.templateRegistry.stream() ?? this.streamTemplateQuery() ?? this.defaultStreamTemplate()
	);
	private readonly allAdditionalElements = computed(() => [
		...this.layoutAdditionalElementsDirectives(),
		...this.externalAdditionalElements()
	]);
	readonly layoutAdditionalElementsTopTemplates = computed(() =>
		this.allAdditionalElements()
			.filter((d) => d.slot() === 'top')
			.map((d) => d.template)
	);
	readonly layoutAdditionalElementsDefaultTemplates = computed(() => {
		const templates = this.allAdditionalElements()
			.filter((d) => d.slot() === 'default')
			.map((d) => d.template);
		const fallbackTemplate = this.templateRegistry.layoutAdditionalElements();
		return templates.length > 0 ? templates : fallbackTemplate ? [fallbackTemplate] : [];
	});
	readonly layoutAdditionalElementsBottomTemplates = computed(() =>
		this.allAdditionalElements()
			.filter((d) => d.slot() === 'bottom')
			.map((d) => d.template)
	);
	readonly localParticipant = this.participantService.localParticipant;
	readonly remoteParticipants = computed(
		() => this.directiveService.layoutRemoteParticipantsSignal() ?? this.participantService.remoteParticipants()
	);
	readonly remoteStreamsOverride = input<ParticipantStream[] | undefined>(undefined, { alias: 'ovRemoteStreams' });
	readonly remoteStreams = computed(
		() => this.remoteStreamsOverride() ?? this.remoteParticipants().flatMap((p) => p.streams())
	);
	readonly remoteCameraStreams = computed(() => this.remoteStreams().filter((s) => !s.isScreenStream));
	readonly remoteScreenStreams = computed(() => this.remoteStreams().filter((s) => s.isScreenStream));
	readonly orderedRemoteStreams = computed(() => [...this.remoteCameraStreams(), ...this.remoteScreenStreams()]);
	private readonly allStreams = computed(() => [
		...(this.localParticipant()?.streams() ?? []),
		...this.remoteStreams()
	]);
	readonly minimizedWindows = computed(() =>
		[
			...this.allStreams().map((stream) => ({
				id: stream.streamId,
				title: stream.participant.name ?? '',
				kind: stream.isScreenStream ? 'WINDOW.SCREEN' : 'WINDOW.CAMERA',
				icon: stream.isScreenStream ? 'screen_share' : 'person'
			})),
			...this.pluginWindows().map((plugin) => ({ ...plugin, kind: 'WINDOW.PLUGIN', icon: 'extension' }))
		].filter((window) => this.windowState.windowPlacement(window.id).mode === 'minimized')
	);

	private resizeObserver?: ResizeObserver;
	private mutationObserver?: MutationObserver;
	private readonly layoutShape = computed(() =>
		[
			...this.allStreams().map((stream) =>
				[
					stream.streamId,
					stream.videoTrack?.track && !stream.videoTrack.isMuted ? 'video' : 'poster',
					stream.isPinned,
					this.windowState.windowPlacement(stream.streamId).mode
				].join(':')
			),
			...this.pluginWindows().map((plugin) => `${plugin.id}:${this.windowState.windowPlacement(plugin.id).mode}`)
		].join('|')
	);
	private readonly layoutEffect = effect(() => {
		this.layoutShape();
		untracked(() => this.layoutService.update());
	});

	ngAfterViewInit(): void {
		const container = this.layoutContainer()?.element.nativeElement as HTMLElement | undefined;

		if (!container) return;

		this.layoutService.initialize(container);
		this.resizeObserver = new ResizeObserver(() => {
			this.layoutService.update();
			this.windows().forEach((window) => window.contain());
		});
		this.resizeObserver.observe(container);
		this.mutationObserver = new MutationObserver(() => this.layoutService.update());
		this.mutationObserver.observe(container, { childList: true });
	}

	ngOnDestroy(): void {
		this.resizeObserver?.disconnect();
		this.mutationObserver?.disconnect();
		this.layoutService.clear();
	}

	trackParticipantElement(_: number, stream: ParticipantStream): string {
		return `${stream.participant.identity}-${stream.streamId}`;
	}

	onPlacementChanged(stream?: ParticipantStream): void {
		if (stream?.participant.isLocal && stream.isCameraStream) {
			this.storage.setLocalTileFloating(this.windowState.isStreamFloating(stream.streamId));
		}

		this.layoutService.update();
	}

	onWindowDropped(event: { id: string; point: { x: number; y: number } }): void {
		const rect = this.dock()?.nativeElement.getBoundingClientRect();

		if (
			rect &&
			event.point.x >= rect.left &&
			event.point.x <= rect.right &&
			event.point.y >= rect.top &&
			event.point.y <= rect.bottom
		) {
			this.windowState.setWindowMode(event.id, 'minimized');
			this.layoutService.update();
		}
	}

	restoreWindow(id: string): void {
		this.windowState.setWindowMode(id, 'floating');
		this.windowState.activeWindow.set(id);
		this.layoutService.update();
	}
}
