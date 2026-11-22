import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { RuntimeConfigService } from '../../../../shared/services/runtime-config.service';
import { PanelService } from '../../openvidu-components/services/panel/panel.service';
import { PluginActivationService } from '../../services/plugin-activation.service';
import {
	PluginCatalogService,
	PluginPermissionGroup,
	PluginPermissionKind,
	RegistryPlugin
} from '../../services/plugin-catalog.service';

interface VersionSelection {
	pluginId: string;
	versions: string[];
	loading: boolean;
	failed: boolean;
}

type PermissionSelection = { pluginId: string; version: string } & (
	{ status: 'loading' | 'failed' } | { status: 'loaded'; groups: PluginPermissionGroup[] }
);

const mediaPermissions = new Set(['AUDIO', 'VIDEO', 'SCREEN_SHARE', 'SCREEN_SHARE_AUDIO']);
const knownPermissions: Partial<Record<PluginPermissionKind, ReadonlySet<string>>> = {
	INITIAL_STATE: new Set(['participants']),
	EVENT_TYPES: new Set([
		'participant.joined',
		'participant.left',
		'participant.connection_aborted',
		'participant.reconnecting',
		'participant.reconnected',
		'participant.kicked',
		'media.audio_muted',
		'media.audio_unmuted',
		'media.video_enabled',
		'media.video_disabled',
		'media.screen_share_started',
		'media.screen_share_stopped',
		'media.track_published',
		'media.track_unpublished',
		'interaction.chat_message_received',
		'call.ended'
	]),
	EVENT_GROUPS: new Set(['participant', 'media', 'interaction', 'call']),
	MEDIA_INPUT: mediaPermissions,
	MEDIA_OUTPUT: mediaPermissions
};

@Component({
	selector: 'ov-meeting-plugins-panel',
	imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, TranslatePipe],
	templateUrl: './meeting-plugins-panel.component.html',
	styleUrls: [
		'../../openvidu-components/components/panel/panel.component.scss',
		'./meeting-plugins-panel.component.scss'
	]
})
export class MeetingPluginsPanelComponent {
	private readonly catalog = inject(PluginCatalogService);
	private readonly runtimeConfig = inject(RuntimeConfigService);
	protected readonly activation = inject(PluginActivationService);
	readonly panels = inject(PanelService);
	readonly plugins = signal<readonly RegistryPlugin[]>([]);
	readonly loading = signal(false);
	readonly loadFailed = signal(false);
	protected readonly selection = signal<VersionSelection | null>(null);
	protected readonly permissions = signal<PermissionSelection | null>(null);
	protected readonly activationFailed = signal<string | null>(null);

	constructor() {
		effect(() => {
			if (this.runtimeConfig.isReadyForRequests()) untracked(() => void this.load());
		});
	}

	async load(): Promise<void> {
		if (this.loading()) return;

		this.loading.set(true);
		this.loadFailed.set(false);

		try {
			const plugins: RegistryPlugin[] = [];
			let page = 1;
			let totalPages: number;

			do {
				const result = await this.catalog.list(page++);
				plugins.push(...result.items);
				totalPages = result.totalPages;
			} while (page <= totalPages);

			this.plugins.set(plugins);
		} catch {
			this.loadFailed.set(true);
		} finally {
			this.loading.set(false);
		}
	}

	protected async chooseVersion(pluginId: string): Promise<void> {
		const request: VersionSelection = { pluginId, versions: [], loading: true, failed: false };
		this.selection.set(request);
		this.permissions.set(null);
		this.activationFailed.set(null);

		try {
			const versions = await this.catalog.listVersions(pluginId);

			if (this.selection() === request) {
				this.selection.set({ ...request, loading: false, versions });

				if (versions.length === 1) void this.selectVersion(versions[0]);
			}
		} catch {
			if (this.selection() === request) this.selection.set({ ...request, loading: false, failed: true });
		}
	}

	protected async selectVersion(version: string): Promise<void> {
		const selection = this.selection();
		this.activationFailed.set(null);

		if (!selection || !selection.versions.includes(version)) {
			this.permissions.set(null);
			return;
		}

		const request: PermissionSelection = { pluginId: selection.pluginId, version, status: 'loading' };
		this.permissions.set(request);

		try {
			const groups = await this.catalog.getPermissions(request.pluginId, version);

			if (this.permissions() === request) this.permissions.set({ ...request, status: 'loaded', groups });
		} catch {
			if (this.permissions() === request) this.permissions.set({ ...request, status: 'failed' });
		}
	}

	protected permissionLabel(kind: PluginPermissionKind, value: string): string | undefined {
		if (!knownPermissions[kind]?.has(value)) return undefined;

		const group = kind === 'MEDIA_INPUT' || kind === 'MEDIA_OUTPUT' ? 'MEDIA' : kind;
		return `PLUGINS.PERMISSIONS.VALUES.${group}.${value}`;
	}

	protected async activatePlugin(pluginId: string): Promise<void> {
		const permissions = this.permissions();

		if (permissions?.status !== 'loaded' || permissions.pluginId !== pluginId) return;

		this.activationFailed.set(null);

		if (!(await this.activation.activate(pluginId, permissions.version))) this.activationFailed.set(pluginId);
	}
}
