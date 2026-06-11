import { describe, expect, it } from 'vitest';
import { HandRegistry } from '../src/gesture/handRegistry';

describe('HandRegistry', () => {
  it('assigns a new id to a new hand and keeps it across frames', () => {
    const registry = new HandRegistry();
    const first = registry.assign([{ palm: { x: 0.3, y: 0.5 }, handedness: 'Left' as const }], 0);
    const second = registry.assign([{ palm: { x: 0.32, y: 0.51 }, handedness: 'Left' as const }], 33);
    expect(first.ids).toHaveLength(1);
    expect(second.ids[0]).toBe(first.ids[0]);
  });

  it('keeps identities when the input array order swaps', () => {
    const registry = new HandRegistry();
    const frame1 = registry.assign(
      [
        { palm: { x: 0.2, y: 0.5 }, handedness: 'Left' as const },
        { palm: { x: 0.8, y: 0.5 }, handedness: 'Right' as const },
      ],
      0,
    );
    // Same hands, swapped array order (MediaPipe does this).
    const frame2 = registry.assign(
      [
        { palm: { x: 0.81, y: 0.5 }, handedness: 'Right' as const },
        { palm: { x: 0.21, y: 0.5 }, handedness: 'Left' as const },
      ],
      33,
    );
    expect(frame2.ids[0]).toBe(frame1.ids[1]);
    expect(frame2.ids[1]).toBe(frame1.ids[0]);
  });

  it('matches by position even when handedness labels flip', () => {
    const registry = new HandRegistry();
    const frame1 = registry.assign([{ palm: { x: 0.4, y: 0.4 }, handedness: 'Left' as const }], 0);
    const frame2 = registry.assign([{ palm: { x: 0.41, y: 0.4 }, handedness: 'Right' as const }], 33);
    expect(frame2.ids[0]).toBe(frame1.ids[0]);
  });

  it('treats a far jump beyond the gate as a new hand', () => {
    const registry = new HandRegistry();
    const frame1 = registry.assign([{ palm: { x: 0.1, y: 0.1 }, handedness: 'Left' as const }], 0);
    const frame2 = registry.assign([{ palm: { x: 0.9, y: 0.9 }, handedness: 'Left' as const }], 33);
    expect(frame2.ids[0]).not.toBe(frame1.ids[0]);
  });

  it('coasts a briefly missing hand, then reports it lost after the TTL', () => {
    const registry = new HandRegistry();
    const frame1 = registry.assign([{ palm: { x: 0.5, y: 0.5 }, handedness: 'Left' as const }], 0);
    const id = frame1.ids[0];

    // Hand missing for one frame, within TTL: not lost yet.
    const frame2 = registry.assign([], 100);
    expect(frame2.lostIds).toHaveLength(0);

    // Reappears nearby: same id.
    const frame3 = registry.assign([{ palm: { x: 0.52, y: 0.5 }, handedness: 'Left' as const }], 150);
    expect(frame3.ids[0]).toBe(id);

    // Gone past the TTL (200ms): lost.
    registry.assign([], 200);
    const frame5 = registry.assign([], 500);
    expect(frame5.lostIds).toContain(id);
  });
});
