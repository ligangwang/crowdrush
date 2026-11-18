/** Saved progress and synthesised sound shared by Crowd Rush. */
import type { GameEvent } from "./crowd-core";
import type { DingnGame } from "../sdk/dingn-sdk.js";
// Saved through the dingn SDK's device storage. Reads stay synchronous: the
// saved values are loaded once at startup (loadStore) and kept here.
export const STORE = {
  level: "level",
  best: "best",
  sound: "sound",
  /** The UTC day on which today's dingn coins were all collected. */
  coinsDone: "coinsDone",
};
type Storage = Pick<DingnGame["storage"], "get" | "set">;
const cache = new Map<string, string>();
let backend: Storage | null = null;
/** Loads the saved values before the game starts. */
export async function loadStore(storage: Storage) {
  backend = storage;
  cache.clear();
  await Promise.all(
    Object.values(STORE).map(async (key) => {
      try {
        const value = await storage.get(key);
        if (value != null) cache.set(key, String(value));
      } catch {}
    }),
  );
}
export const read = (key: string) => cache.get(key) ?? null;
export const write = (key: string, value: string) => {
  cache.set(key, value);
  backend?.set(key, value).catch(() => {});
};

/** Sounds the game asks for besides the world's own events. */
export type SfxCue =
  | GameEvent
  /** A volley; `power` from 0 (one rifle) to 1 (a huge, upgraded squad). */
  | { type: "shot"; power?: number }
  /** Explosions bursting on the beaten boss as it staggers. */
  | { type: "blast" }
  /** The beaten boss crashing to the ground. */
  | { type: "impact" }
  /** The victory fanfare once the boss is down. */
  | { type: "fanfare" };

const note = (base: number, semis: number) => base * 2 ** (semis / 12);

/**
 * Synthesised sound effects: no audio files are downloaded. Every sound is
 * built from oscillators and filtered noise, with a short room reverb on
 * the bigger ones so they sound full rather than beepy.
 */
export class Sfx {
  private ctx?: AudioContext;
  private out?: GainNode;
  private verb?: GainNode;
  private noise?: AudioBuffer;
  private last: Record<string, number> = {};
  on = true;
  private ensure() {
    if (this.ctx) return this.ctx;
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!Ctor) return undefined;
    try {
      const ctx = new Ctor();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      const out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(comp);
      // a short room: decaying noise as the impulse, mixed in quietly
      const verb = ctx.createGain();
      verb.gain.value = 0.22;
      const conv = ctx.createConvolver();
      const ir = ctx.createBuffer(
        2,
        Math.floor(ctx.sampleRate * 1.1),
        ctx.sampleRate,
      );
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < d.length; i++)
          d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
      }
      conv.buffer = ir;
      verb.connect(conv).connect(comp);
      const len = Math.floor(ctx.sampleRate * 1.2);
      const noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.out = out;
      this.verb = verb;
      this.noise = noise;
    } catch {
      return undefined;
    }
    return this.ctx;
  }
  wake() {
    const ctx = this.ensure();
    if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
  }
  private gap(name: string, seconds: number) {
    const now = this.ctx?.currentTime ?? 0;
    if (now - (this.last[name] ?? -1) < seconds) return false;
    this.last[name] = now;
    return true;
  }
  /** Sends a sound to the speakers, and some of it to the room reverb. */
  private send(node: AudioNode, wet = 0) {
    if (!this.out) return;
    node.connect(this.out);
    if (wet > 0 && this.verb) {
      const g = this.ctx!.createGain();
      g.gain.value = wet;
      node.connect(g).connect(this.verb);
    }
  }
  /** One oscillator gliding from `freq` to `to`, with a quick attack. */
  private tone(
    freq: number,
    to: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    delay = 0,
    wet = 0,
    detune = 0,
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.send(g, wet);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  /** A fat chord: each note doubled by a slightly detuned copy. */
  private chord(
    root: number,
    semis: number[],
    dur: number,
    vol: number,
    delay = 0,
    type: OscillatorType = "sawtooth",
  ) {
    for (const n of semis) {
      const f = note(root, n);
      this.tone(f, f, dur, type, vol, delay, 0.5, -9);
      this.tone(f, f, dur, type, vol, delay, 0.5, 9);
    }
  }
  /** Filtered noise: a thump (lowpass), crack (highpass) or whoosh (sweep). */
  private noiseHit(
    kind: BiquadFilterType,
    freq: number,
    dur: number,
    vol: number,
    delay = 0,
    sweepTo?: number,
    wet = 0,
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.noise) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.Q.value = kind === "bandpass" ? 1.4 : 0.7;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    if (sweepTo) {
      // a whoosh swells in, then dies away
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    s.connect(f).connect(g);
    this.send(g, wet);
    s.start(t, Math.random() * 0.4);
    s.stop(t + dur + 0.02);
  }
  /** A deep explosion: a low boom with a sinking sub-bass under it. */
  private boom(size: number, delay = 0) {
    this.noiseHit(
      "lowpass",
      700 * size,
      0.5 + 0.5 * size,
      0.9,
      delay,
      undefined,
      0.6,
    );
    this.noiseHit("highpass", 2500, 0.12, 0.25 * size, delay);
    this.tone(110, 30, 0.5 + 0.4 * size, "sine", 0.7 * size, delay, 0.3);
  }
  play(e: SfxCue) {
    if (!this.on || !this.ensure()) return;
    switch (e.type) {
      case "shot": {
        // a bigger, upgraded squad sounds heavier: lower, louder, more boom
        const p = Math.max(0, Math.min(1, e.power ?? 0));
        if (!this.gap("shot", 0.075 - p * 0.02)) break;
        this.noiseHit("highpass", 3200 - p * 1600, 0.045, 0.09 + p * 0.07);
        this.tone(
          880 - p * 420 + Math.random() * 120,
          220 - p * 90,
          0.07,
          "square",
          0.035,
        );
        if (p > 0.25)
          this.noiseHit("lowpass", 260 + p * 200, 0.09, 0.12 + p * 0.25);
        break;
      }
      case "hit":
        if (e.target === "boss") {
          if (this.gap("hit-boss", 0.06)) {
            this.noiseHit("lowpass", 420, 0.1, 0.35);
            this.tone(150, 70, 0.08, "triangle", 0.18);
          }
        } else if (this.gap("hit", 0.05))
          this.tone(460, 130, 0.05, "triangle", 0.1);
        break;
      case "gate": {
        if (e.good) {
          // soldiers join: a bright rising chord over a whoosh and a bass
          // hit, bigger the more the squad grew
          const grow = Math.min(
            1,
            Math.log2(Math.max(1, e.after / Math.max(1, e.before))) / 2,
          );
          this.noiseHit("bandpass", 500, 0.32, 0.25 + grow * 0.2, 0, 4000);
          this.tone(98, 49, 0.35, "sine", 0.5, 0.05);
          [0, 4, 7, 12].forEach((n, i) =>
            this.tone(
              note(523, n),
              note(523, n),
              0.22,
              "triangle",
              0.18,
              0.05 + i * 0.05,
              0.4,
            ),
          );
          this.chord(
            262,
            [0, 4, 7],
            0.5 + grow * 0.3,
            0.035 + grow * 0.025,
            0.25,
          );
          if (grow > 0.4)
            [19, 24].forEach((n, i) =>
              this.tone(
                note(523, n),
                note(523, n),
                0.3,
                "sine",
                0.1,
                0.32 + i * 0.07,
                0.6,
              ),
            );
        } else {
          this.tone(330, 98, 0.45, "sawtooth", 0.13, 0, 0.3);
          this.tone(311, 92, 0.45, "sawtooth", 0.09, 0.03, 0.3);
          this.noiseHit("lowpass", 600, 0.3, 0.35);
        }
        break;
      }
      case "upgrade":
        if (e.kind === "power") {
          // POWER: a heavy impact, a rising roar, then a big chord stab
          this.boom(0.7);
          this.tone(70, 560, 0.45, "sawtooth", 0.16, 0.02, 0.3);
          this.tone(72, 570, 0.45, "sawtooth", 0.12, 0.02, 0.3, 12);
          this.chord(note(220, 3), [0, 7, 12, 15], 0.7, 0.045, 0.42);
          this.tone(1760, 2637, 0.4, "sine", 0.08, 0.5, 0.7);
        } else {
          // RATE: a fast ticking run that speeds up, ending in a bright ping
          let at = 0;
          for (let i = 0; i < 10; i++) {
            const f = note(660, i * 1.5);
            this.tone(f, f * 1.02, 0.05, "square", 0.08, at);
            at += 0.055 - i * 0.003;
          }
          this.noiseHit("bandpass", 900, 0.4, 0.22, 0, 7000);
          this.tone(
            note(660, 17),
            note(660, 19),
            0.5,
            "triangle",
            0.18,
            at,
            0.6,
          );
          this.chord(note(330, 5), [0, 4, 7], 0.5, 0.03, at);
        }
        break;
      case "coin":
        this.tone(1568, 1568, 0.06, "square", 0.08);
        this.tone(2093, 2093, 0.2, "square", 0.08, 0.06, 0.4);
        break;
      case "crate": {
        // a crate breaks open and soldiers spill out
        this.noiseHit("lowpass", 1200, 0.18, 0.45);
        const n = Math.min(5, 2 + Math.floor(e.reward / 8));
        for (let i = 0; i < n; i++)
          this.tone(
            note(784, i * 2),
            note(784, i * 2),
            0.1,
            "square",
            0.08,
            0.05 + i * 0.05,
          );
        this.tone(
          note(784, n * 2 + 3),
          note(784, n * 2 + 3),
          0.3,
          "triangle",
          0.14,
          0.05 + n * 0.05,
          0.5,
        );
        break;
      }
      case "wall":
        this.noiseHit("lowpass", 900, 0.35, 0.8, 0, undefined, 0.3);
        this.tone(140, 50, 0.3, "sine", 0.5);
        break;
      case "clash":
        this.noiseHit("lowpass", 1100, 0.3, 0.7, 0, undefined, 0.3);
        this.noiseHit("highpass", 2000, 0.15, 0.25);
        break;
      case "kill":
        if (e.big) {
          this.boom(0.55);
          this.tone(784, 1568, 0.2, "square", 0.1, 0.05);
        } else if (this.gap("kill", 0.06)) {
          this.tone(660, 1320, 0.08, "square", 0.07);
          this.noiseHit("bandpass", 1800, 0.06, 0.12);
        }
        break;
      case "bite":
        if (this.gap("bite", 0.08)) this.noiseHit("lowpass", 1400, 0.15, 0.5);
        break;
      case "summon":
        this.tone(140, 260, 0.45, "sawtooth", 0.12, 0, 0.4);
        this.tone(147, 270, 0.45, "sawtooth", 0.08, 0.02, 0.4);
        break;
      case "slam":
        this.boom(1);
        this.tone(90, 40, 0.6, "sine", 0.6);
        break;
      case "won":
        // the boss is beaten: a huge explosion and a dying roar
        this.boom(1.2);
        this.tone(320, 55, 1.3, "sawtooth", 0.16, 0.05, 0.5);
        this.tone(330, 52, 1.3, "sawtooth", 0.12, 0.08, 0.5, 15);
        break;
      case "blast":
        this.boom(0.6 + Math.random() * 0.3);
        break;
      case "impact":
        this.boom(1.4);
        this.noiseHit("lowpass", 200, 1.2, 0.8, 0.05, undefined, 0.8);
        break;
      case "fanfare":
        this.chord(262, [0, 4, 7], 0.3, 0.04, 0, "sawtooth");
        [0, 4, 7, 12, 16, 19, 24].forEach((n, i) =>
          this.tone(
            note(523, n),
            note(523, n),
            0.3,
            "triangle",
            0.18,
            i * 0.08,
            0.5,
          ),
        );
        this.chord(262, [12, 16, 19, 24], 1.3, 0.05, 0.56, "sawtooth");
        this.tone(note(523, 24), note(523, 24), 1.2, "sine", 0.12, 0.56, 0.7);
        break;
      case "lost":
        [7, 4, 0, -5].forEach((s, i) =>
          this.tone(
            note(392, s),
            note(392, s),
            0.32,
            "triangle",
            0.18,
            i * 0.15,
            0.5,
          ),
        );
        this.tone(98, 49, 0.9, "sine", 0.4, 0.45);
        break;
    }
  }
  close() {
    void this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }
}
