import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import {
	afterRenderEffect,
	Component,
	computed,
	DestroyRef,
	inject,
	input,
	output,
	signal,
	untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '../../../pipes/translate.pipe';
import { StreamLayoutStateService, WindowRect } from '../../../services/layout/stream-layout-state.service';

@Component({
	selector: 'ov-window-shell',
	imports: [CdkDragHandle, MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
	hostDirectives: [CdkDrag],
	templateUrl: './window-shell.component.html',
	styleUrl: './window-shell.component.scss',
	host: {
		class: 'OV_root OV_publisher',
		'[class.OV_floating]': 'floating()',
		'[class.OV_ignored]': 'minimized()',
		'[class.window-active]': 'floating() && state.activeWindow() === windowId()',
		'[class.interacting]': 'interacting()',
		'[style.--window-width]': "rect().width + 'px'",
		'[style.--window-height]': "rect().height + 'px'",
		'[attr.data-window-id]': 'windowId()',
		'[attr.aria-label]': 'title()',
		role: 'group',
		'(pointerdown)': 'activate()',
		'(focusin)': 'activate()',
		'(window:blur)': 'activateFocusedFrame()'
	}
})
export class WindowShellComponent {
	readonly state = inject(StreamLayoutStateService);
	private readonly drag = inject(CdkDrag);
	readonly windowId = input.required<string>();
	readonly title = input.required<string>();
	readonly boundary = input.required<HTMLElement>();
	readonly controlsVisible = input(true);
	readonly placementChanged = output<void>();
	readonly isDragging = signal(false);
	readonly dropped = output<{ id: string; point: { x: number; y: number } }>();
	readonly mode = computed(() => this.state.windowPlacement(this.windowId()).mode);
	readonly floating = computed(() => this.mode() === 'floating');
	readonly minimized = computed(() => this.mode() === 'minimized');
	readonly rect = signal<WindowRect>({ x: 0, y: 0, width: 320, height: 220 });
	readonly interacting = signal(false);
	readonly corners = ['nw', 'ne', 'sw', 'se'];
	private resize?: { pointer: number; x: number; y: number; corner: string; rect: WindowRect; handle: HTMLElement };
	private dragStartRect?: WindowRect;

	constructor() {
		afterRenderEffect(() => {
			const placement = this.state.windowPlacement(this.windowId());
			this.drag.disabled = placement.mode !== 'floating' || !this.controlsVisible();

			untracked(() => {
				if (this.interacting()) return;

				if (placement.mode === 'floating') {
					const bounds = this.boundary();
					this.applyRect(
						placement.rect ?? {
							x: Math.max(0, bounds.clientWidth - 325),
							y: Math.max(0, bounds.clientHeight - 220),
							width: 320,
							height: 220
						}
					);
				} else if (placement.mode === 'grid') {
					this.drag.reset();
				}
			});
		});
		this.drag.started.pipe(takeUntilDestroyed()).subscribe(() => {
			this.dragStartRect = { ...this.rect() };
			this.activate();
			this.interacting.set(true);
			this.isDragging.set(true);
		});
		this.drag.ended.pipe(takeUntilDestroyed()).subscribe((event) => {
			const position = this.drag.getFreeDragPosition();
			this.dropped.emit({ id: this.windowId(), point: event.dropPoint });
			this.applyRect(
				this.minimized() && this.dragStartRect ? this.dragStartRect : { ...this.rect(), ...position }
			);
			this.saveRect();
			this.interacting.set(false);
			this.isDragging.set(false);
		});
		inject(DestroyRef).onDestroy(() => this.finishResize(true, false));
	}

	activate(): void {
		if (this.floating()) this.state.activeWindow.set(this.windowId());
	}

	activateFocusedFrame(): void {
		const element = this.drag.element.nativeElement as HTMLElement;
		const root = element.getRootNode() as Document | ShadowRoot;

		if (root.activeElement?.tagName === 'IFRAME' && element.contains(root.activeElement)) this.activate();
	}

	setMode(mode: 'grid' | 'floating' | 'minimized'): void {
		if (this.floating()) this.saveRect();

		this.state.setWindowMode(this.windowId(), mode);

		if (mode === 'floating') this.state.activeWindow.set(this.windowId());

		this.placementChanged.emit();
	}

	contain(): void {
		if (!this.floating() || this.interacting()) return;

		this.applyRect(this.rect());
		this.saveRect();
	}

	onResizeStart(event: PointerEvent, corner: string): void {
		if (!this.floating() || event.button !== 0) return;

		event.preventDefault();
		event.stopPropagation();
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		this.resize = {
			pointer: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			corner,
			rect: { ...this.rect() },
			handle
		};
		this.activate();
		this.interacting.set(true);
	}

	onResizeMove(event: PointerEvent): void {
		const resize = this.resize;

		if (!resize || resize.pointer !== event.pointerId) return;

		const dx = event.clientX - resize.x;
		const dy = event.clientY - resize.y;
		const left = resize.corner.includes('w');
		const top = resize.corner.includes('n');
		const bounds = this.boundary();
		const minWidth = Math.min(160, bounds.clientWidth);
		const minHeight = Math.min(100, bounds.clientHeight);
		const x = left
			? Math.max(0, Math.min(resize.rect.x + dx, resize.rect.x + resize.rect.width - minWidth))
			: resize.rect.x;
		const y = top
			? Math.max(0, Math.min(resize.rect.y + dy, resize.rect.y + resize.rect.height - minHeight))
			: resize.rect.y;
		this.applyRect({
			x,
			y,
			width: left ? resize.rect.width + resize.rect.x - x : resize.rect.width + dx,
			height: top ? resize.rect.height + resize.rect.y - y : resize.rect.height + dy
		});
	}

	finishResize(cancelled = false, persist = true): void {
		const resize = this.resize;

		if (!resize) return;

		this.resize = undefined;

		if (cancelled) this.applyRect(resize.rect);

		if (resize.handle.hasPointerCapture(resize.pointer)) resize.handle.releasePointerCapture(resize.pointer);

		this.interacting.set(false);

		if (persist) this.saveRect();
	}

	onGeometryKey(event: KeyboardEvent, resizing = false): void {
		if (event.key === 'Escape' && this.resize) {
			this.finishResize(true);
			return;
		}

		if (!this.floating() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;

		event.preventDefault();
		event.stopPropagation();
		const step = event.shiftKey ? 10 : 1;
		const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
		const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
		const rect = this.rect();
		this.applyRect(
			resizing
				? { ...rect, width: rect.width + dx, height: rect.height + dy }
				: { ...rect, x: rect.x + dx, y: rect.y + dy }
		);
		this.saveRect();
	}

	private applyRect(rect: WindowRect): void {
		const bounds = this.boundary();
		const width = Math.min(bounds.clientWidth, Math.max(Math.min(160, bounds.clientWidth), rect.width));
		const height = Math.min(bounds.clientHeight, Math.max(Math.min(100, bounds.clientHeight), rect.height));
		const next = {
			width,
			height,
			x: Math.max(0, Math.min(bounds.clientWidth - width, rect.x)),
			y: Math.max(0, Math.min(bounds.clientHeight - height, rect.y))
		};
		this.rect.set(next);
		this.drag.setFreeDragPosition({ x: next.x, y: next.y });
	}

	private saveRect(): void {
		this.state.setWindowRect(this.windowId(), this.rect());
	}
}
