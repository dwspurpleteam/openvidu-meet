import { Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { PanelService } from '../../openvidu-components/services/panel/panel.service';
import { PluginManagerService } from '../../services/plugin-manager.service';
import { PluginCatalogEntry, PluginRegistryService } from '../../services/plugin-registry.service';

@Component({
	selector: 'ov-meeting-plugins-panel',
	imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, TranslatePipe],
	templateUrl: './meeting-plugins-panel.component.html',
	styleUrls: [
		'../../openvidu-components/components/panel/panel.component.scss',
		'./meeting-plugins-panel.component.scss'
	]
})
export class MeetingPluginsPanelComponent implements OnInit {
	readonly manager = inject(PluginManagerService);
	readonly registry = inject(PluginRegistryService);
	readonly panels = inject(PanelService);
	readonly plugins = signal<readonly PluginCatalogEntry[]>([]);
	readonly loading = signal(false);
	readonly loadFailed = signal(false);

	ngOnInit(): void {
		void this.load();
	}

	async load(): Promise<void> {
		if (this.loading()) return;

		this.loading.set(true);
		this.loadFailed.set(false);

		try {
			const plugins: PluginCatalogEntry[] = [];
			let page = 1;
			let totalPages: number;

			do {
				const result = await this.registry.list(page++);
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

	status(pluginId: string): string {
		const error = this.manager.errors()[pluginId];
		return (
			this.manager.pending()[pluginId] ??
			this.manager.activations().find((item) => item.pluginId === pluginId)?.state ??
			error ??
			(!this.manager.canActivate(pluginId) ? 'FORBIDDEN' : 'AVAILABLE')
		);
	}
}
