import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

export interface PluginWindow {
	id: string;
	title: string;
	url: string;
}

@Component({
	selector: 'ov-plugin-iframe-window',
	template: `
		<iframe
			[src]="resourceUrl()"
			[title]="plugin().title"
			sandbox="allow-scripts"
			allow="camera 'none'; microphone 'none'; display-capture 'none'; geolocation 'none'"
			referrerpolicy="no-referrer"
		></iframe>
	`,
	styles: `
		:host {
			display: block;
			height: 100%;
		}
		iframe {
			display: block;
			width: 100%;
			height: 100%;
			border: 0;
			background: white;
		}
	`
})
export class PluginIframeWindowComponent {
	private readonly sanitizer = inject(DomSanitizer);
	readonly plugin = input.required<PluginWindow>();
	// URLs come from the built-in demo or from MEET_PLUGINS, which the server accepts only as http(s).
	readonly resourceUrl = computed(() => this.sanitizer.bypassSecurityTrustResourceUrl(this.plugin().url));
}
