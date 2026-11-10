import { useEffect, useRef, useState } from "react";
import { useDingn, useLocale } from "./dingn";
import { STORE, Sfx, read, write } from "./crowd-shared";
import {
  FREE_LEVELS,
  mergeProgress,
  needsSignIn,
  parseProgress,
  readCrowdProgress,
  sameProgress,
  saveCrowdProgress,
  type CrowdProgress,
} from "./crowd-progress";
import {
  CRIT_PERK,
  RATE_PERK,
  defeated,
  lossCoins,
  newLevel,
  progress,
  stars,
  start,
  steer,
  step,
  type GameEvent,
  type World,
} from "./crowd-core";
import type { CrowdScene, SceneFx } from "./crowd-scene";
import { createBadgeTracker } from "./crowd-badges";
import {
  buyUpgrade,
  loadPerks,
  nextUpgrade,
  TIERS,
  UPGRADE_KINDS,
  type BuyResult,
  type UpgradeKind,
} from "./crowd-upgrades";
import type { Perks } from "./crowd-core";

const TEAM = "#3ea6ff";
const RIVAL = "#ff5a5f";
const MAX_FLOATS = 24;

const localProgress = () => parseProgress(read(STORE.level), read(STORE.best));
function storeLocal(p: CrowdProgress) {
  write(STORE.level, String(p.level));
  write(STORE.best, String(p.best));
}

type Spark = SceneFx["sparks"][number] & { vx: number; vz: number; vh: number };
type Float = {
  text: string;
  x: number;
  z: number;
  h: number;
  life: number;
  color: string;
  big: boolean;
};

/**
 * Crowd Rush, drawn in 3D with three.js. The rules and levels live in
 * crowd-core; this component handles input, sound, the HUD and overlays.
 */
export function CrowdGame() {
  const { t, locale } = useLocale();
  const sdk = useDingn();
  // the 3D scene paints words onto crates, so it reads the current language
  const tRef = useRef(t);
  tRef.current = t;
  // Levels past FREE_LEVELS need an account; progress then syncs to it.
  // dingn hands the game only whether someone is signed in and their name.
  const user = sdk.player.signedIn ? sdk.player : null;
  const sessionReady = true;
  const uidRef = useRef<string | null>(null);
  uidRef.current = user ? user.name || "player" : null;
  // dingn badges for cleared levels (crowd-badges.ts), checked again whenever
  // the player signs in or out.
  const badges = useRef<ReturnType<typeof createBadgeTracker> | null>(null);
  badges.current ??= createBadgeTracker();
  // The game loop keeps its first closure, so it reads the SDK (and whether
  // the player is signed in now) through this ref.
  const sdkRef = useRef(sdk);
  sdkRef.current = sdk;
  useEffect(() => badges.current?.reset(), [sdk.player.signedIn]);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const bossBarRef = useRef<HTMLDivElement>(null);
  const bossFillRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CrowdScene | null>(null);
  // repaint crate words when the language changes mid-level
  useEffect(() => {
    sceneRef.current?.relabel();
  }, [locale]);
  const sfx = useRef<Sfx | null>(null);
  const world = useRef<World>(newLevel(1));
  const fx = useRef({
    sparks: [] as Spark[],
    floats: [] as Float[],
    shake: 0,
    bossHit: 0,
    slamAnim: 0,
    clock: 0,
    acc: 0,
    shots: 0,
    width: 1,
    drag: null as null | { id: number; x0: number; target0: number },
    keys: { left: false, right: false },
    paused: false,
  });
  const [phase, setPhase] = useState<World["phase"]>("ready");
  const [level, setLevel] = useState(1);
  const [result, setResult] = useState({ count: 0, stars: 0 });
  // A failed level still pays dingn coins for the enemies destroyed: the
  // share destroyed, and coins paid (null while asking, or signed out).
  const [loss, setLoss] = useState<{
    share: number;
    coins: number | null;
    limit: boolean;
  }>({ share: 0, coins: null, limit: false });
  const [sound, setSound] = useState(true);
  const [noGl, setNoGl] = useState(false);
  const [weapon, setWeapon] = useState({ power: 1, rapid: 0 });
  // Upgrades bought with dingn coins; every level starts with them.
  const [perks, setPerks] = useState<Perks>({ power: 0, rate: 0 });
  const perksRef = useRef(perks);
  perksRef.current = perks;
  const [buying, setBuying] = useState<UpgradeKind | null>(null);
  const [shopNote, setShopNote] = useState("");
  // The upgrade the player couldn't afford, shown as a notice on the panel.
  const [poor, setPoor] = useState<{
    kind: UpgradeKind;
    tier: number;
    price: number;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void loadPerks(sdk).then((p) => active && setPerks(p));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk.player.signedIn]);
  // A level waiting to start picks up an upgrade bought just now.
  useEffect(() => {
    const w = world.current;
    if (w.phase === "ready") w.perks = { ...perks };
  }, [perks]);
  async function buy(kind: UpgradeKind) {
    const next = nextUpgrade(kind, perksRef.current);
    if (!next || buying) return;
    if (!uidRef.current) return sdk.requestSignIn();
    setBuying(kind);
    setShopNote("");
    setPoor(null);
    const result: BuyResult = await buyUpgrade(sdk, next.id);
    setBuying(null);
    if (result === "bought") setPerks(await loadPerks(sdk));
    else if (result === "poor")
      setPoor({ kind, tier: next.tier, price: next.price });
    else if (result === "failed")
      setShopNote(tRef.current("The upgrade shop is unavailable right now."));
  }
  const locked = needsSignIn(level, !!user);

  function load(lv: number) {
    world.current = newLevel(lv);
    world.current.perks = { ...perksRef.current };
    const f = fx.current;
    f.sparks = [];
    f.floats = [];
    f.shake = 0;
    f.slamAnim = 0;
    sceneRef.current?.load(world.current);
    setWeapon({ power: 1, rapid: 0 });
    setLevel(lv);
    setPhase("ready");
  }

  function begin() {
    sfx.current?.wake();
    const w = world.current;
    if (w.phase === "ready" && !needsSignIn(w.level, !!uidRef.current)) {
      start(w);
      setPhase("run");
      canvasRef.current?.focus({ preventScroll: true });
      fitStage();
    }
  }
  /** On a phone the stage fills the screen; scroll it fully into view to play. */
  function fitStage() {
    const stage = stageRef.current;
    if (!stage || typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(max-width: 640px), (pointer: coarse)").matches)
      return;
    const r = stage.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight + 1)
      stage.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }
  const next = () => load(world.current.level + 1);
  const retry = () => load(world.current.level);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const f = fx.current;
    let disposed = false;
    let raf = 0;
    let observer: ResizeObserver | undefined;
    const { level: saved } = localProgress();
    const s = read(STORE.sound) !== "off";
    setSound(s);
    sfx.current = new Sfx();
    sfx.current.on = s;
    world.current = newLevel(saved);
    world.current.perks = { ...perksRef.current };
    setLevel(saved);
    if (import.meta.env.DEV)
      (window as unknown as { __crowd?: typeof world }).__crowd = world;

    const pause = () => {
      f.paused = document.hidden;
    };
    const blur = () => {
      f.paused = true;
      f.keys.left = f.keys.right = false;
    };
    const focus = () => {
      f.paused = false;
    };
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);

    // three.js is loaded only on this page, after the menu is on screen
    void import("./crowd-scene")
      .then(({ CrowdScene }) => {
        if (disposed) return;
        let scene: CrowdScene;
        try {
          scene = new CrowdScene(canvas);
        } catch {
          setNoGl(true);
          return;
        }
        scene.translate = (text) => tRef.current(text);
        sceneRef.current = scene;
        if (import.meta.env.DEV)
          (window as unknown as { __crowdScene?: CrowdScene }).__crowdScene =
            scene;
        const layout = () => {
          const rect = stage.getBoundingClientRect();
          f.width = Math.max(1, rect.width);
          scene.resize(
            f.width,
            Math.max(1, rect.height),
            window.devicePixelRatio || 1,
          );
        };
        layout();
        observer =
          typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(layout)
            : undefined;
        observer?.observe(stage);
        scene.load(world.current);
        // the Polyfork models replace the code-built characters once loaded
        scene
          .loadModels()
          .catch((err) => console.warn("Crowd Rush models", err));
        let last = performance.now();
        const loop = (now: number) => {
          raf = requestAnimationFrame(loop);
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          update(f.paused ? 0 : dt);
          scene.render(world.current, f, f.paused ? 0 : dt);
          overlay(scene);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => setNoGl(true));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      sceneRef.current?.dispose();
      sceneRef.current = null;
      sfx.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On sign-in, merge this device's progress with the account's and keep
  // whichever got further, so nothing played signed out is lost.
  const uid = user ? user.name || "player" : undefined;
  useEffect(() => {
    if (!uid) return;
    let active = true;
    readCrowdProgress(sdk)
      .then((remote) => {
        if (!active) return;
        const merged = mergeProgress(localProgress(), remote);
        storeLocal(merged);
        // A returning player gets the badges for levels they cleared before
        // badges existed (or on another device) right away, in one popup.
        if (merged.best > 0)
          void badges.current?.cleared(sdkRef.current, merged.best, 0);
        const w = world.current;
        if (w.phase === "ready" && w.level < merged.level) load(merged.level);
        if (!sameProgress(merged, remote))
          return saveCrowdProgress(sdk, merged);
      })
      .catch((err) => console.warn("Crowd Rush progress", err));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  function update(dt: number) {
    const f = fx.current;
    const w = world.current;
    f.clock += dt;
    if (f.keys.left !== f.keys.right)
      steer(w, w.targetX + (f.keys.left ? -2.2 : 2.2) * dt);
    const was = w.phase;
    f.acc += dt;
    while (f.acc >= 1 / 60) {
      f.acc -= 1 / 60;
      step(w, 1 / 60);
      for (const e of w.events) react(e);
      w.events.length = 0;
    }
    if (w.shotsFired !== f.shots) {
      f.shots = w.shotsFired;
      sfx.current?.play({ type: "shot" });
    }
    if (was !== w.phase) {
      setPhase(w.phase);
      if (w.phase === "lost") {
        const coins = lossCoins(w);
        setLoss({ share: defeated(w), coins: null, limit: false });
        if (coins > 0 && uidRef.current)
          sdkRef.current.rewards
            .earn(coins)
            .then((paid) =>
              setLoss((l) => ({
                ...l,
                coins: paid.coins,
                limit: paid.coins < coins,
              })),
            )
            .catch((err) => console.warn("Crowd Rush coins", err));
      }
      if (w.phase === "won") {
        setResult({ count: w.count, stars: stars(w) });
        void badges.current?.cleared(sdkRef.current, w.level, stars(w));
        const saved = mergeProgress(localProgress(), {
          level: w.level + 1,
          best: w.level,
        });
        storeLocal(saved);
        const uid = uidRef.current;
        if (uid)
          saveCrowdProgress(sdk, saved).catch((err) =>
            console.warn("Crowd Rush progress", err),
          );
      }
    }
    for (const p of f.sparks) {
      p.life += dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.vh -= 9 * dt;
      p.h = Math.max(0.05, p.h + p.vh * dt);
    }
    f.sparks = f.sparks.filter((p) => p.life < p.max);
    for (const fl of f.floats) {
      fl.life += dt;
      fl.h += dt * 1.2;
    }
    f.floats = f.floats.filter((fl) => fl.life < 1.1);
    f.shake = Math.max(0, f.shake - dt * 2.5);
    f.bossHit = Math.max(0, f.bossHit - dt * 6);
    f.slamAnim = Math.max(0, f.slamAnim - dt * 2.2);
  }

  function burst(
    x: number,
    z: number,
    h: number,
    color: string,
    n: number,
    power = 3,
  ) {
    const f = fx.current;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      f.sparks.push({
        x,
        z,
        h,
        vx: Math.cos(a) * 0.12 * power * Math.random(),
        vz: Math.sin(a) * power * Math.random(),
        vh: 2 + Math.random() * power,
        life: 0,
        max: 0.45 + Math.random() * 0.45,
        color,
        size: 0.06 + Math.random() * 0.07,
      });
    }
    if (f.sparks.length > 600) f.sparks.splice(0, f.sparks.length - 600);
  }
  function float(
    text: string,
    x: number,
    z: number,
    h: number,
    color: string,
    big: boolean,
  ) {
    const f = fx.current;
    f.floats.push({ text, x, z, h, life: 0, color, big });
    if (f.floats.length > MAX_FLOATS) f.floats.shift();
  }

  function react(e: GameEvent) {
    const f = fx.current;
    const w = world.current;
    if (e.type !== "hit") sfx.current?.play(e);
    switch (e.type) {
      case "gate": {
        const d = e.after - e.before;
        float(
          `${d >= 0 ? "+" : ""}${d}`,
          w.x,
          w.z + 1.5,
          1.8,
          e.good ? "#9dff6a" : "#ff8a8a",
          true,
        );
        burst(w.x, w.z + 1, 0.6, e.good ? "#9dff6a" : "#ff8a8a", 24);
        if (!e.good) f.shake = Math.max(f.shake, 0.35);
        break;
      }
      case "hit":
        if (e.target === "boss") {
          f.bossHit = 1;
          if (Math.random() < 0.3)
            burst(e.x, e.z - 1.2, 2.5 + Math.random() * 3, "#ffd36a", 2, 2);
          if (Math.random() < 0.08) sfx.current?.play(e);
        } else {
          const c =
            e.target === "squad"
              ? RIVAL
              : e.target === "monster"
                ? "#8be04e"
                : "#ffd36a";
          burst(e.x, e.z, 0.6, c, 2, 1.5);
          sfx.current?.play(e);
        }
        break;
      case "upgrade": {
        const power = e.kind === "power";
        float(
          power ? t(`Damage ×${e.level}`) : t("Faster fire"),
          e.x,
          e.z,
          2,
          power ? "#ff9b7a" : "#8fe3ff",
          true,
        );
        burst(e.x, e.z, 0.7, power ? "#ff5a4a" : "#3fc4ff", 40, 5);
        burst(w.x, w.z, 0.4, power ? "#ffd36a" : "#bff1ff", 24, 3);
        setWeapon({ power: w.power, rapid: w.rapid });
        break;
      }
      case "crate":
        float(`+${e.reward}`, e.x, e.z, 1.6, "#ffe066", true);
        burst(e.x, e.z, 0.7, "#ffcf3a", 30, 4);
        burst(e.x, e.z, 0.7, "#a8661c", 14, 4);
        break;
      case "kill":
        burst(
          e.x,
          e.z,
          0.5,
          e.big ? "#c77dff" : "#8be04e",
          e.big ? 36 : 12,
          e.big ? 5 : 3,
        );
        if (e.reward)
          float(`+${e.reward}`, e.x, e.z, e.big ? 2 : 1.1, "#9dff6a", e.big);
        if (e.big) f.shake = Math.max(f.shake, 0.3);
        break;
      case "bite":
        float(`−${e.lost}`, e.x, e.z, 1.2, "#ff8a8a", e.lost > 1);
        burst(e.x, e.z, 0.5, TEAM, 6 + e.lost * 2, 3);
        if (e.lost > 1) f.shake = Math.max(f.shake, 0.35);
        break;
      case "wall":
        if (e.lost) float(`−${e.lost}`, e.x, e.z, 1.8, "#ff8a8a", true);
        burst(e.x, e.z, 0.8, "#c9c1b4", 28, 4);
        f.shake = Math.max(f.shake, 0.5);
        break;
      case "clash":
        float(`−${e.lost}`, e.x, e.z, 1.4, "#ff8a8a", true);
        burst(e.x, e.z, 0.5, RIVAL, 26, 4);
        burst(e.x, e.z, 0.5, TEAM, 20, 4);
        f.shake = Math.max(f.shake, 0.45);
        break;
      case "slam":
        f.slamAnim = 1;
        f.shake = 0.8;
        float(`−${e.lost}`, w.x, w.z + 1, 1.6, "#ff8a8a", true);
        burst(w.x, w.z + 0.5, 0.2, TEAM, Math.min(30, 6 + e.lost), 3);
        break;
      case "won":
        burst(0, w.boss.z, 4, "#ffd36a", 90, 7);
        burst(0, w.boss.z, 4, "#a580ff", 70, 6);
        break;
    }
  }

  /** Count bubbles and floating numbers, placed over the 3D view each frame. */
  function overlay(scene: CrowdScene) {
    const root = labelsRef.current;
    if (!root) return;
    const f = fx.current;
    const w = world.current;
    const items: {
      text: string;
      x: number;
      y: number;
      cls: string;
      color?: string;
      alpha?: number;
    }[] = [];
    if (w.count > 0) {
      const p = scene.project(w.x, w.z, 1.7);
      items.push({
        text: String(w.count),
        x: p.x,
        y: p.y,
        cls: "crowd3d-count",
      });
    }
    for (const th of w.things)
      if (
        th.kind === "squad" &&
        !th.dead &&
        th.count > 0 &&
        th.z > w.z &&
        th.z - w.z < 80
      ) {
        const p = scene.project(th.x, th.z, 1.7);
        if (p.visible)
          items.push({
            text: String(th.count),
            x: p.x,
            y: p.y,
            cls: "crowd3d-count rival",
          });
      }
    for (const fl of f.floats) {
      const p = scene.project(fl.x, fl.z, fl.h);
      if (p.visible)
        items.push({
          text: fl.text,
          x: p.x,
          y: p.y,
          cls: fl.big ? "crowd3d-float big" : "crowd3d-float",
          color: fl.color,
          alpha: Math.max(0, 1 - fl.life / 1.1),
        });
    }
    while (root.children.length < items.length)
      root.appendChild(document.createElement("span"));
    for (let i = 0; i < root.children.length; i++) {
      const el = root.children[i] as HTMLSpanElement;
      const it = items[i];
      if (!it) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      if (el.textContent !== it.text) el.textContent = it.text;
      if (el.className !== it.cls) el.className = it.cls;
      el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.color = it.color ?? "";
      el.style.opacity = it.alpha === undefined ? "" : it.alpha.toFixed(2);
    }
    if (progressRef.current)
      progressRef.current.style.width = `${Math.max(4, progress(w) * 100)}%`;
    const showBoss = w.phase === "boss" || w.phase === "won";
    if (bossBarRef.current) bossBarRef.current.hidden = !showBoss;
    if (bossFillRef.current && showBoss) {
      bossFillRef.current.style.width = `${(w.boss.hp / w.boss.maxHp) * 100}%`;
      bossFillRef.current.dataset.hit = f.bossHit > 0 ? "1" : "";
      bossFillRef.current.textContent = String(w.boss.hp);
    }
  }

  // input
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    sfx.current?.wake();
    const w = world.current;
    if (w.phase === "ready") begin();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    fx.current.drag = { id: e.pointerId, x0: e.clientX, target0: w.targetX };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = fx.current.drag;
    if (!drag || drag.id !== e.pointerId) return;
    const span = Math.min(fx.current.width * 0.42, 260);
    steer(world.current, drag.target0 + (e.clientX - drag.x0) / span);
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (fx.current.drag?.id === e.pointerId) fx.current.drag = null;
  }
  function onKey(e: React.KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    const keys = fx.current.keys;
    if (k === "arrowleft" || k === "a") keys.left = down;
    else if (k === "arrowright" || k === "d") keys.right = down;
    else if (down && (k === "enter" || k === " ")) {
      const ph = world.current.phase;
      if (ph === "ready") begin();
      else if (ph === "won") next();
      else if (ph === "lost") retry();
    } else return;
    e.preventDefault();
  }
  function toggleSound() {
    const s = !sound;
    setSound(s);
    if (sfx.current) sfx.current.on = s;
    write(STORE.sound, s ? "on" : "off");
    if (s) sfx.current?.wake();
  }

  return (
    <div className="crowd-page">
      <h1 className="sr-only">{t("Crowd Rush")}</h1>
      <div className="crowd-stage crowd3d-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="crowd-canvas"
          tabIndex={0}
          role="application"
          aria-label={t(
            "Crowd Rush. Use the left and right arrow keys to steer. Press Enter to start.",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => onKey(e, true)}
          onKeyUp={(e) => onKey(e, false)}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="crowd3d-labels" ref={labelsRef} aria-hidden="true" />
        <div className="crowd3d-bars" aria-hidden="true">
          <div className="crowd3d-progress">
            <div ref={progressRef} />
          </div>
          <div className="crowd3d-boss" ref={bossBarRef} hidden>
            <div ref={bossFillRef} />
          </div>
        </div>
        <div className="crowd-hud">
          <span className="crowd-hud-left">
            <span className="crowd-level">{t(`Level ${level}`)}</span>
            {(weapon.power > 1 || weapon.rapid > 0) && (
              <span
                className="crowd-weapon"
                aria-label={t(
                  `Damage ${weapon.power}, fire rate level ${weapon.rapid}`,
                )}
              >
                {weapon.power > 1 && (
                  <b className="power">DMG ×{weapon.power}</b>
                )}
                {weapon.rapid > 0 && (
                  <b className="rate">RATE +{weapon.rapid}</b>
                )}
              </span>
            )}
          </span>
          <button type="button" aria-pressed={sound} onClick={toggleSound}>
            {sound ? t("Sound on") : t("Sound off")}
          </button>
        </div>
        {noGl && (
          <div className="crowd-overlay">
            <h2>{t("3D isn't available here")}</h2>
            <p>{t("Crowd Rush needs WebGL, which this browser can't draw.")}</p>
            <button
              type="button"
              className="button"
              onClick={() => sdk.navigate("/")}
            >
              {t("Back to games")}
            </button>
          </div>
        )}
        {!noGl && phase === "ready" && locked && !sessionReady && (
          <div className="crowd-overlay">
            <p role="status">{t("Loading your game…")}</p>
          </div>
        )}
        {!noGl && phase === "ready" && locked && sessionReady && (
          <div className="crowd-overlay crowd-gate">
            <p className="eyebrow">{t(`Level ${level}`)}</p>
            <h2>{t("Save your progress to keep going")}</h2>
            <p>
              {t(
                `You've cleared the first ${FREE_LEVELS} levels. Sign in for free to play level ${FREE_LEVELS + 1} and beyond, and pick up where you left off on any device.`,
              )}
            </p>
            <div className="crowd-actions">
              <button
                type="button"
                className="button"
                onClick={() => sdk.requestSignIn()}
              >
                {t("Sign in to keep playing")}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => load(FREE_LEVELS)}
              >
                {t(`Replay level ${FREE_LEVELS}`)}
              </button>
            </div>
          </div>
        )}
        {!noGl && phase === "ready" && !locked && (
          <div className="crowd-overlay">
            <p className="eyebrow">{t(`Level ${level}`)}</p>
            <h2>{t("Ready to rush?")}</h2>
            <button type="button" className="button" onClick={begin}>
              {t("Start")}
            </button>
            {/* Signed-out players see the upgrades too; buying asks them
                to sign in first, since coins belong to a dingn account. */}
            <div className="crowd-shop" role="group" aria-label={t("Upgrades")}>
              <p className="crowd-shop-title">
                {t("Upgrades")}
                <span>
                  {user
                    ? t("Permanent, paid with dingn coins")
                    : t("Sign in to buy with dingn coins")}
                </span>
              </p>
              {UPGRADE_KINDS.map((kind) => {
                const next = nextUpgrade(kind, perks);
                const name = kind === "power" ? t("Power") : t("Fire rate");
                const per = kind === "power" ? CRIT_PERK : RATE_PERK;
                const pct = (tier: number) => Math.round(per * tier * 100);
                const label =
                  kind === "power" ? t("2× damage chance") : t("Fire speed");
                const value = (tier: number) =>
                  kind === "power" ? `${pct(tier)}%` : `+${pct(tier)}%`;
                return (
                  <div
                    key={kind}
                    className={`crowd-shop-row${next ? " can-buy" : ""}`}
                    // the whole row upgrades too; the button is for keyboards
                    onClick={() => next && void buy(kind)}
                  >
                    <span className={`crowd-shop-icon ${kind}`} aria-hidden />
                    <span className="crowd-shop-info">
                      <span className="crowd-shop-name">
                        {name}
                        <span
                          className="crowd-shop-tiers"
                          aria-label={t(`Level ${perks[kind]} of ${TIERS}`)}
                        >
                          {Array.from({ length: TIERS }, (_, i) => (
                            <i
                              key={i}
                              className={i < perks[kind] ? "on" : ""}
                            />
                          ))}
                        </span>
                      </span>
                      <span className="crowd-shop-effect">
                        {label}{" "}
                        {next ? (
                          <>
                            {perks[kind] > 0 && (
                              <>
                                {value(perks[kind])}
                                <b aria-hidden> → </b>
                              </>
                            )}
                            <em>{value(next.tier)}</em>
                          </>
                        ) : (
                          <em>{value(perks[kind])}</em>
                        )}
                      </span>
                    </span>
                    {next ? (
                      <button
                        type="button"
                        className={`crowd-shop-buy${poor?.kind === kind ? " poor" : ""}`}
                        disabled={!!buying}
                        onClick={(e) => {
                          e.stopPropagation();
                          void buy(kind);
                        }}
                        aria-label={
                          user
                            ? t(
                                `Buy ${name} +${next.tier} for ${next.price} coins`,
                              )
                            : t(`Sign in to buy ${name} +${next.tier}`)
                        }
                      >
                        <span className="crowd-shop-buy-label">
                          <span aria-hidden>▲</span> {t("Upgrade")}
                        </span>
                        <span className="crowd-shop-buy-price">
                          <span className="crowd-coin" aria-hidden />
                          {next.price}
                        </span>
                      </button>
                    ) : (
                      <span className="crowd-shop-max">{t("Max")}</span>
                    )}
                  </div>
                );
              })}
              {poor && (
                <div className="crowd-shop-poor" role="alert">
                  <span className="crowd-shop-poor-icon" aria-hidden>
                    <span className="crowd-coin" />
                  </span>
                  <span className="crowd-shop-poor-text">
                    <strong>{t("Not enough coins")}</strong>
                    <span>
                      {t(
                        `${poor.kind === "power" ? t("Power") : t("Fire rate")} +${poor.tier} costs ${poor.price} coins.`,
                      )}
                    </span>
                    <span>
                      {t(
                        "Earn more by clearing levels for badges, or by taking out enemies even when a level fails.",
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="crowd-shop-poor-close"
                    onClick={() => setPoor(null)}
                    aria-label={t("Close")}
                  >
                    ×
                  </button>
                </div>
              )}
              {shopNote && <p className="crowd-shop-note">{shopNote}</p>}
            </div>
          </div>
        )}
        {phase === "won" && (
          <div className="crowd-overlay">
            <p
              className="crowd-stars"
              aria-label={t(`${result.stars} of 3 stars`)}
            >
              {"★".repeat(result.stars)}
              <span>{"★".repeat(3 - result.stars)}</span>
            </p>
            <h2>{t("Boss down!")}</h2>
            <p>{t(`${result.count} of your squad made it.`)}</p>
            {needsSignIn(level + 1, !!user) && (
              <p>
                {t(
                  "Next up: sign in to save your progress and keep playing on any device.",
                )}
              </p>
            )}
            <div className="crowd-actions">
              <button type="button" className="button" onClick={next}>
                {t("Next level →")}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={retry}
              >
                {t("Replay")}
              </button>
            </div>
          </div>
        )}
        {phase === "lost" && (
          <div className="crowd-overlay">
            <h2>{t("Squad wiped out")}</h2>
            {loss.share > 0 && (
              <p className="crowd-loss">
                {t(
                  `You took out ${Math.round(loss.share * 100)}% of the enemies.`,
                )}
                {loss.coins != null && loss.coins > 0 && (
                  <span className="crowd-loss-coins">
                    <span className="crowd-coin" aria-hidden />
                    {t(`+${loss.coins} coins`)}
                  </span>
                )}
                {loss.limit && (
                  <span className="crowd-loss-note">
                    {t(
                      "Daily coin limit reached. Come back tomorrow for more.",
                    )}
                  </span>
                )}
                {!user && lossCoins(world.current) > 0 && (
                  <span className="crowd-loss-note">
                    {t("Sign in to earn coins for that.")}
                  </span>
                )}
                {user && lossCoins(world.current) === 0 && (
                  <span className="crowd-loss-note">
                    {t("Take out 20% to earn a coin.")}
                  </span>
                )}
              </p>
            )}
            <p>
              {t(
                "Pick the bigger gate and shoot the crates for extra recruits.",
              )}
            </p>
            <button type="button" className="button" onClick={retry}>
              {t("Try again")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
