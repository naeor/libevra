export interface Box { x: number; y: number; width: number; height: number }
export const EASE: string;
export const EXPANSION_MIDDLE: number;
export const EXPANSION_END: number;
export const FIRST_EASE: string;
export function relativeRect(rect: DOMRect, parent: DOMRect): Box;
export function expandedRect(width: number, height: number): Box;
export function reliableTarget(saved: Box, current: Box | null, viewport: { width: number; height: number }, changed?: boolean): boolean;
export function surroundingPose(style: string, rect: Box, source: Box, strength: number, viewport?: { height: number }): Keyframe;
export function boxFrame(box: Box, radius?: number, scale?: number): Keyframe;
export function expansionFrames(first: Keyframe, middle: Keyframe, last: Keyframe): Keyframe[];
export function pushFrames(rect: Box, source: Box, viewport: { height: number }): Keyframe[];
