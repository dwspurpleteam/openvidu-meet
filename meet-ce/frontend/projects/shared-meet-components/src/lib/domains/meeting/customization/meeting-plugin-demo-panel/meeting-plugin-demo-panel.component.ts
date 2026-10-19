import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '../../openvidu-components/pipes/translate.pipe';

@Component({
	selector: 'ov-meeting-plugin-demo-panel',
	imports: [MatButtonModule, TranslatePipe],
	template: `
		<span>{{ 'WINDOW.DEMO' | translate }}</span>
		<button
			type="button"
			mat-stroked-button
			data-testid="add-demo-plugin"
			[disabled]="disabled()"
			(click)="add.emit()"
		>
			{{ 'WINDOW.ADD_DEMO' | translate }} ({{ count() }}/4)
		</button>
		@if (count() >= 4) {
			<span role="status">{{ 'WINDOW.DEMO_LIMIT' | translate }}</span>
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
export class MeetingPluginDemoPanelComponent {
	readonly count = input(0);
	readonly disabled = input(false);
	readonly add = output<void>();
}
