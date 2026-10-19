import { Service, signal } from '@angular/core';
import { ParticipantModel, ParticipantViewStateReader } from '../../models/participant.model';
import { Track } from '../livekit';

export interface WindowRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface WindowPlacement {
	mode: 'grid' | 'floating' | 'minimized';
	rect?: WindowRect;
}

const GRID_PLACEMENT: WindowPlacement = { mode: 'grid' };

/** Per-participant forcible-mute flags, one per stream scope. */
interface ForcedMuteScopes {
	camera: boolean;
	screen: boolean;
}

/**
 * Owns the per-viewer *stream view state* — which streams are pinned or floating, which
 * participants are forcibly muted for this viewer, and the screen-share publication dates used to
 * pin the most recent share. This state used to be monkey-patched onto LiveKit
 * `TrackPublication` objects inside `ParticipantModel`, which tied its lifetime to the tracks
 * (state died or resurrected as publications came and went) and required manual `bump()` calls to
 * make the writes visible. Here it lives in signals keyed by stream id / participant sid, so
 * `ParticipantModel.streams()` picks up changes reactively and the state survives track
 * republishes.
 *
 * Keys: pin/float state is keyed by `ParticipantStream.streamId` — `camera-<identity>` for camera
 * streams, which is stable across camera toggles and reconnect republishes and makes
 * pinning/floating an avatar-only tile work, or the video track SID for screen streams. Forcible
 * mutes are keyed by participant SID so they survive the participant's own publish/unpublish
 * cycles.
 *
 * The service deliberately has no dependencies: `ParticipantService` (the registry) hands it to
 * every model it creates, and callers that operate on "the local participant" pass the model in.
 */
@Service()
export class StreamLayoutStateService implements ParticipantViewStateReader {
	private readonly _pinnedStreams = signal<ReadonlySet<string>>(new Set());
	private readonly _windows = signal<ReadonlyMap<string, WindowPlacement>>(new Map());
	readonly activeWindow = signal<string | undefined>(undefined);
	private readonly _forcedMutes = signal<ReadonlyMap<string, ForcedMuteScopes>>(new Map());
	/**
	 * Publication date per screen-share track SID, used by {@link setLastScreenPinned} to enlarge
	 * the most recent share. Read only imperatively, so a plain Map suffices.
	 */
	private readonly screenSharePublicationDates = new Map<string, number>();

	// ── ParticipantViewStateReader (consumed by ParticipantModel.streams()) ─────────────────────
	/**
	 * @internal
	 */
	isStreamPinned(streamId: string): boolean {
		return this._pinnedStreams().has(streamId);
	}

	/**
	 * @internal
	 */
	isStreamFloating(streamId: string): boolean {
		return this.windowPlacement(streamId).mode !== 'grid';
	}

	windowPlacement(id: string): WindowPlacement {
		return this._windows().get(id) ?? GRID_PLACEMENT;
	}

	setWindowMode(id: string, mode: WindowPlacement['mode']): void {
		if (this.windowPlacement(id).mode === mode) return;

		if (mode !== 'grid') {
			this._pinnedStreams.update((pinned) => StreamLayoutStateService.withoutKeys(pinned, [id]));
		}

		if (mode !== 'floating' && this.activeWindow() === id) this.activeWindow.set(undefined);

		this._windows.update((windows) => new Map(windows).set(id, { ...this.windowPlacement(id), mode }));
	}

	setWindowRect(id: string, rect: WindowRect): void {
		const placement = this.windowPlacement(id);
		const previous = placement.rect;

		if (
			previous?.x === rect.x &&
			previous.y === rect.y &&
			previous.width === rect.width &&
			previous.height === rect.height
		)
			return;

		this._windows.update((windows) => new Map(windows).set(id, { ...placement, rect }));
	}

	clearWindow(id: string): void {
		this._windows.update((windows) => {
			if (!windows.has(id)) return windows;

			const next = new Map(windows);
			next.delete(id);
			return next;
		});
		this._pinnedStreams.update((pinned) => StreamLayoutStateService.withoutKeys(pinned, [id]));

		if (this.activeWindow() === id) this.activeWindow.set(undefined);
	}

	pinStreamIfInGrid(streamId: string | undefined): void {
		if (!streamId || this.isStreamFloating(streamId) || this.isStreamPinned(streamId)) return;

		this._pinnedStreams.update((pinned) => new Set(pinned).add(streamId));
	}

	/**
	 * @internal
	 */
	isCameraStreamMuted(participantSid: string): boolean {
		return this._forcedMutes().get(participantSid)?.camera ?? false;
	}

	/**
	 * @internal
	 */
	isScreenStreamMuted(participantSid: string): boolean {
		return this._forcedMutes().get(participantSid)?.screen ?? false;
	}

	// ── Pin / float mutations ────────────────────────────────────────────────────────────────────
	/**
	 * Toggles the pinned (enlarged) state of a stream.
	 * @internal
	 */
	toggleStreamPinned(streamId: string | undefined) {
		if (!streamId) return;

		this.setWindowMode(streamId, 'grid');
		this._pinnedStreams.update((pinned) => StreamLayoutStateService.toggledSet(pinned, streamId));
	}

	/**
	 * Toggles the floating (picture-in-picture) state of a stream.
	 * @internal
	 */
	toggleStreamFloating(streamId: string | undefined) {
		if (!streamId) return;

		this.setWindowMode(streamId, this.isStreamFloating(streamId) ? 'grid' : 'floating');
	}

	/**
	 * Restores every stream to its normal size.
	 * @internal
	 */
	unpinAllStreams() {
		if (this._pinnedStreams().size === 0) return;

		this._pinnedStreams.set(new Set());
	}

	/**
	 * Floats the local camera video if it is not already floating.
	 * Called automatically when the first remote participant joins the room.
	 * @internal
	 */
	floatLocalCameraVideo(local: ParticipantModel | undefined): void {
		const cameraStream = local?.streams().find((s) => s.isCameraStream);

		if (cameraStream && !this.isStreamFloating(cameraStream.streamId)) {
			this.setWindowMode(cameraStream.streamId, 'floating');
		}
	}

	/**
	 * Restores the local camera video to the layout if it is currently floating.
	 * Called automatically when the last remote participant leaves the room.
	 * @internal
	 */
	dockLocalCameraVideo(local: ParticipantModel | undefined): void {
		const cameraStream = local?.streams().find((s) => s.isCameraStream);

		if (cameraStream && this.windowPlacement(cameraStream.streamId).mode !== 'minimized') {
			this.setWindowMode(cameraStream.streamId, 'grid');
		}
	}

	// ── Forcible mute ────────────────────────────────────────────────────────────────────────────
	/**
	 * Forcibly mutes (or un-mutes) a participant's streams for this viewer.
	 *
	 * When {@link source} is provided, only the matching stream scope is affected (`Camera` covers
	 * the camera/microphone stream, `ScreenShare` covers the screen-share stream). Omit it to
	 * affect both. Keyed by participant SID, so the mute survives the participant republishing
	 * tracks (e.g. toggling their own camera or microphone) until it is explicitly lifted or the
	 * participant leaves.
	 * @internal
	 */
	setParticipantMutedForcibly(participantSid: string, muted: boolean, source?: Track.Source) {
		const affectsCamera = !source || source === Track.Source.Camera;
		const affectsScreen = !source || source === Track.Source.ScreenShare;

		this._forcedMutes.update((mutes) => {
			const current = mutes.get(participantSid) ?? { camera: false, screen: false };
			const next: ForcedMuteScopes = {
				camera: affectsCamera ? muted : current.camera,
				screen: affectsScreen ? muted : current.screen
			};

			if (next.camera === current.camera && next.screen === current.screen) return mutes;

			const updated = new Map(mutes);

			if (next.camera || next.screen) {
				updated.set(participantSid, next);
			} else {
				updated.delete(participantSid);
			}

			return updated;
		});
	}

	// ── Screen-share publication bookkeeping ─────────────────────────────────────────────────────
	/**
	 * Records when a screen-share track was published, so {@link setLastScreenPinned} can pick the
	 * most recent share.
	 * @internal
	 */
	recordScreenSharePublication(trackSid: string, publishedAt: number) {
		this.screenSharePublicationDates.set(trackSid, publishedAt);
	}

	/**
	 * Drops the publication date of a screen-share track that is no longer live.
	 * @internal
	 */
	clearScreenSharePublication(trackSid: string) {
		this.screenSharePublicationDates.delete(trackSid);
	}

	/**
	 * Pins the most recently published screen share, if any. Callers unpin everything first
	 * (see the screen-share handlers), so "pin" and "toggle" are equivalent here — pinning is
	 * used because it is idempotent.
	 * @internal
	 */
	setLastScreenPinned() {
		let lastTrackSid: string | undefined;
		let lastPublishedAt = -Infinity;

		for (const [trackSid, publishedAt] of this.screenSharePublicationDates) {
			if (publishedAt > lastPublishedAt && !this.isStreamFloating(trackSid)) {
				lastPublishedAt = publishedAt;
				lastTrackSid = trackSid;
			}
		}

		if (!lastTrackSid || this.isStreamPinned(lastTrackSid)) return;

		this.pinStreamIfInGrid(lastTrackSid);
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────────────────────────
	/**
	 * Drops every view-state entry belonging to the given participant. Called when a remote
	 * participant leaves so that a later participant reusing the same identity (rejoin) does not
	 * inherit stale pins, floats or mutes.
	 * @internal
	 */
	clearParticipantViewState(participant: ParticipantModel) {
		const streamIds = participant.streams().map((s) => s.streamId);

		streamIds.forEach((id) => this.clearWindow(id));
		this.setParticipantMutedForcibly(participant.sid, false);

		for (const stream of participant.streams()) {
			if (stream.isScreenStream) this.screenSharePublicationDates.delete(stream.streamId);
		}
	}

	/**
	 * Resets all view state. Called when the meeting is torn down.
	 * @internal
	 */
	clearAllViewState() {
		this._pinnedStreams.set(new Set());
		this._windows.set(new Map());
		this.activeWindow.set(undefined);
		this._forcedMutes.set(new Map());
		this.screenSharePublicationDates.clear();
	}

	// ── Helpers ──────────────────────────────────────────────────────────────────────────────────
	private static toggledSet(source: ReadonlySet<string>, key: string): ReadonlySet<string> {
		const updated = new Set(source);

		if (!updated.delete(key)) {
			updated.add(key);
		}

		return updated;
	}

	private static withoutKeys(source: ReadonlySet<string>, keys: string[]): ReadonlySet<string> {
		if (!keys.some((key) => source.has(key))) return source;

		const updated = new Set(source);
		keys.forEach((key) => updated.delete(key));
		return updated;
	}
}
