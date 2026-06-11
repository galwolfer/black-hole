import { GESTURE_CONFIG } from './config';
import { distance } from './metrics';
import type { Handedness, Point } from './types';

type Candidate = {
  palm: Point;
  handedness: Handedness;
};

type Track = {
  id: number;
  palm: Point;
  handedness: Handedness;
  lastSeenMs: number;
};

export type AssignResult = {
  /** Stable id for each input hand, same order as the input array. */
  ids: number[];
  /** Tracks that exceeded the TTL this frame. */
  lostIds: number[];
};

/**
 * Greedy nearest-neighbor association of detected hands to persistent tracks.
 * Position dominates; handedness only breaks ties. Tracks coast for a short
 * TTL through detection dropouts before being declared lost.
 */
export class HandRegistry {
  private tracks: Track[] = [];
  private nextId = 1;

  assign(hands: Candidate[], nowMs: number): AssignResult {
    const { matchGate, trackTtlMs } = GESTURE_CONFIG.identity;
    const ids: number[] = new Array(hands.length).fill(0);
    const usedTracks = new Set<number>();
    const usedHands = new Set<number>();

    // All candidate pairs within the gate, cheapest first; same-handedness
    // pairs get a small bonus so labels break ties without overriding position.
    const pairs: Array<{ trackIndex: number; handIndex: number; cost: number }> = [];
    this.tracks.forEach((track, trackIndex) => {
      hands.forEach((hand, handIndex) => {
        const d = distance(track.palm, hand.palm);
        if (d < matchGate) {
          const tieBreak = track.handedness === hand.handedness ? 0 : 0.01;
          pairs.push({ trackIndex, handIndex, cost: d + tieBreak });
        }
      });
    });
    pairs.sort((a, b) => a.cost - b.cost);

    for (const pair of pairs) {
      if (usedTracks.has(pair.trackIndex) || usedHands.has(pair.handIndex)) {
        continue;
      }
      usedTracks.add(pair.trackIndex);
      usedHands.add(pair.handIndex);
      const track = this.tracks[pair.trackIndex];
      const hand = hands[pair.handIndex];
      track.palm = hand.palm;
      track.handedness = hand.handedness;
      track.lastSeenMs = nowMs;
      ids[pair.handIndex] = track.id;
    }

    hands.forEach((hand, handIndex) => {
      if (usedHands.has(handIndex)) {
        return;
      }
      const track: Track = {
        id: this.nextId,
        palm: hand.palm,
        handedness: hand.handedness,
        lastSeenMs: nowMs,
      };
      this.nextId += 1;
      this.tracks.push(track);
      ids[handIndex] = track.id;
    });

    const lostIds: number[] = [];
    this.tracks = this.tracks.filter((track) => {
      if (nowMs - track.lastSeenMs > trackTtlMs) {
        lostIds.push(track.id);
        return false;
      }
      return true;
    });

    return { ids, lostIds };
  }
}
