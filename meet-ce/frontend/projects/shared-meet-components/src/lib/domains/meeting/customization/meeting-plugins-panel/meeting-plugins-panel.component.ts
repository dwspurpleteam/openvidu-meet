import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PluginConfig } from '../../../../shared/services/runtime-config.service';
import { TranslatePipe } from '../../openvidu-components/pipes/translate.pipe';

@Component({
	selector: 'ov-meeting-plugins-panel',
	imports: [MatButtonModule, TranslatePipe],
	template: `
		<span>{{ 'WINDOW.PLUGINS' | translate }}</span>
		@for (plugin of plugins(); track plugin.id) {
			@let open = openIds().includes(plugin.id);
			<button
				type="button"
				[matButton]="open ? 'filled' : 'outlined'"
				[attr.aria-pressed]="open"
				[attr.data-testid]="'plugin-' + plugin.id"
				(click)="toggled.emit(plugin)"
			>
				{{ plugin.title }}
			</button>
		}
	`,
	styles: `
		:host {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px;
			padding: 4px 8px;
			color: var(--ov-text-primary-color);
			font-size: 12px;
		}
	`
})
export class MeetingPluginsPanelComponent {
	readonly plugins = input.required<readonly PluginConfig[]>();
	readonly openIds = input<readonly string[]>([]);
	readonly toggled = output<PluginConfig>();
}
