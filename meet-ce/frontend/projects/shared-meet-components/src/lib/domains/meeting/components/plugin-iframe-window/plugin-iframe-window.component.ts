import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

export interface PluginWindow {
	id: string;
	title: string;
	url: string;
}

export function getPluginIframeUrl(raw: string): string | null {
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
	} catch {
		return null;
	}
}

@Component({
	selector: 'ov-plugin-iframe-window',
	template: `
		@if (resourceUrl(); as url) {
			<iframe
				[src]="url"
				[title]="plugin().title"
				sandbox="allow-scripts"
				allow="camera 'none'; microphone 'none'; display-capture 'none'; geolocation 'none'"
				referrerpolicy="no-referrer"
			></iframe>
		}
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
	private readonly url = computed(() => getPluginIframeUrl(this.plugin().url));
	readonly resourceUrl = computed(() => {
		const url = this.url();
		return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
	});
}
