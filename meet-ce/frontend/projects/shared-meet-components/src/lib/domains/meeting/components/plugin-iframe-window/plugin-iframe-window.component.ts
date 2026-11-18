import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

interface WindowDescriptor {
	id: string;
	title: string;
}

export type PluginWindow = WindowDescriptor & ({ url: string; mock?: false } | { mock: true });

export function getPluginIframeUrl(raw: string): string | null {
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' && url.origin !== window.location.origin && !url.username && !url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}

@Component({
	selector: 'ov-plugin-iframe-window',
	template: `
		@if (plugin().mock) {
			<iframe
				[title]="plugin().title"
				sandbox=""
				referrerpolicy="no-referrer"
				srcdoc="<!doctype html><html lang='en'><meta charset='utf-8'><title>Plugin activation demo</title>
					<body style='font: 16px system-ui; padding: 16px; color: #17212b'>
					<strong>Demo plugin is active</strong><p>This is a simulated plugin window.</p></body></html>"
			></iframe>
		} @else if (resourceUrl(); as url) {
			<iframe
				[src]="url"
				[title]="plugin().title"
				sandbox="allow-scripts allow-same-origin"
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
	private readonly url = computed(() => {
		const plugin = this.plugin();

		return plugin.mock ? null : getPluginIframeUrl(plugin.url);
	});
	readonly resourceUrl = computed(() => {
		const url = this.url();
		return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
	});
}
