import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { RuntimeConfigService } from '../../../../shared/services/runtime-config.service';
import { PanelService } from '../../openvidu-components/services/panel/panel.service';
import { PluginCatalogService, RegistryPlugin } from '../../services/plugin-catalog.service';

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
	readonly panels = inject(PanelService);
	readonly plugins = signal<readonly RegistryPlugin[]>([]);
	readonly loading = signal(false);
	readonly loadFailed = signal(false);

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
}
