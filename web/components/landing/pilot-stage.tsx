"use client";

import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { asset } from "@/lib/config";
import { prefersReducedMotion, ScrollTrigger } from "@/lib/gsap";
import { DRAW_END, LAUNCH_START, pilotScroll } from "@/lib/pilot-scroll";

const MODEL_URL = asset("/mascot/ejecto-pilot.glb");
const MODEL_HEIGHT = 1.35;

/**
 * Full-screen, click-through 3D layer. The pilot follows the page as you scroll
 * (hero, statement, crash) and fires its seat when the crash chart hits EJECT.
 */
export default function PilotStage() {
  useScrollTriggers();
  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-hidden>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 3.1], fov: 30 }}
        gl={{ antialias: true, alpha: true }}
        eventSource={typeof document !== "undefined" ? document.body : undefined}
        eventPrefix="client"
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[2.5, 3, 3]} intensity={2.2} />
        <directionalLight position={[-3, 1, -2]} intensity={1.2} color="#ff4d1f" />
        <Suspense fallback={null}>
          <Pilot />
          <Environment resolution={256}>
            <Lightformer form="rect" intensity={3} position={[0, 3, 2]} scale={[6, 2, 1]} />
            <Lightformer form="rect" intensity={2} color="#ffd400" position={[-4, 0, 1]} scale={[2, 6, 1]} />
            <Lightformer form="rect" intensity={1.5} color="#ff4d1f" position={[4, -1, 1]} scale={[2, 6, 1]} />
          </Environment>
        </Suspense>
      </Canvas>
    </div>
  );
}

/** Wire ScrollTrigger to the shared pilotScroll store. */
function useScrollTriggers() {
  useEffect(() => {
    const hero = document.getElementById("hero");
    const statement = document.getElementById("statement");
    const crash = document.getElementById("crash-track");
    const how = document.getElementById("how");
    const cta = document.getElementById("cta");
    if (!hero || !statement || !crash || !how || !cta) return;
    pilotScroll.howEl = how;
    pilotScroll.resultsEl = document.getElementById("results");
    pilotScroll.safeEl = document.getElementById("safeguards");
    pilotScroll.ctaEl = cta;
    if (prefersReducedMotion()) {
      pilotScroll.hero = 0;
      return;
    }
    const triggers = [
      ScrollTrigger.create({ trigger: hero, start: "top top", end: "bottom top", onUpdate: (s) => (pilotScroll.hero = s.progress) }),
      ScrollTrigger.create({ trigger: statement, start: "top bottom", end: "bottom top", onUpdate: (s) => (pilotScroll.statement = s.progress) }),
      ScrollTrigger.create({ trigger: crash, start: "top bottom", end: "top top", onUpdate: (s) => (pilotScroll.toCrash = s.progress) }),
      ScrollTrigger.create({ trigger: crash, start: "top top", end: "bottom bottom", onUpdate: (s) => (pilotScroll.crash = s.progress) }),
    ];
    return () => {
      triggers.forEach((t) => t.kill());
      pilotScroll.howEl = null;
      pilotScroll.resultsEl = null;
      pilotScroll.safeEl = null;
      pilotScroll.ctaEl = null;
    };
  }, []);
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

type Pose = { x: number; y: number; s: number };

function Pilot() {
  const { scene } = useGLTF(MODEL_URL);
  const viewport = useThree((s) => s.viewport);

  const { model, bottom, nozzleX, nozzleZ } = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = LEGS.uTime;
        shader.uniforms.uKick = LEGS.uKick;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\n${LEG_SWING_GLSL}`)
          .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nobjectNormal = headShake(position, legSwing(position, objectNormal, true), true);")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = headShake(position, legSwing(position, transformed, false), false);");
      };
      mesh.material = mat;
    });
    // The exporter shipped its own lights. We light the scene ourselves.
    const lights: THREE.Object3D[] = [];
    copy.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o);
    });
    lights.forEach((l) => l.removeFromParent());
    // Normalize: fixed height, centered on the origin.
    const box = new THREE.Box3().setFromObject(copy);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = MODEL_HEIGHT / size.y;
    copy.scale.setScalar(k);
    copy.position.set(-center.x * k, -center.y * k, -center.z * k);
    return { model: copy, bottom: -MODEL_HEIGHT / 2, nozzleX: size.x * k * 0.17, nozzleZ: size.z * k * 0.3 };
  }, [scene]);

  const group = useRef<THREE.Group>(null);
  const flames = useRef<THREE.Group>(null);
  const chute = useRef<THREE.Group>(null);
  // Smoothed horizontal speed, the pendulum roll and the eased yaw.
  const motion = useRef({ vx: 0, roll: 0, rollV: 0, yaw: -0.35 });
  // Mouse drag state for spinning the pilot.
  const drag = useRef({ dragging: false, lastX: 0, lastY: 0, rotY: 0, rotX: 0, vel: 0, idle: 0 });

  useFrame((state, rawDelta) => {
    // Cap the frame step. After the tab was hidden, rawDelta can be seconds long, which would blow up
    // the pendulum spring and the drag inertia and make the pilot spin wildly on return.
    const delta = Math.min(rawDelta, 1 / 30);
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    LEGS.uTime.value = t;
    const { width: w, height: h } = viewport;
    const narrow = w / h < 1;
    const vh = window.innerHeight;

    // Poses in world units, relative to the visible area at z = 0.
    const heroPose: Pose = narrow ? { x: 0, y: -h * 0.2, s: 0.5 } : { x: w * 0.25, y: h * 0.06, s: 0.78 };
    const sidePose: Pose = narrow ? { x: w * 0.75, y: 0, s: 0.4 } : { x: w * 0.33, y: 0, s: 0.52 };
    // Sits over the empty top-right of the crash chart, right of the EJECT day.
    const crashPose: Pose = narrow ? { x: w * 0.28, y: h * 0.26, s: 0.24 } : { x: w * 0.31, y: h * 0.02, s: 0.32 };
    // Under the parachute: beside the stacked cards, then beside the final call to action.
    // Zig-zag through the parachute sections: How it works left, The Math right, Safeguards left, then out of frame.
    // Under a parachute the visual middle of pilot + canopy sits CHUTE_MID * scale above the model center,
    // so offset y by that amount to center the whole thing (just below the header, hence -h * 0.02).
    const chuteY = (scale: number) => -h * 0.02 - CHUTE_MID * scale;
    const howPose: Pose = narrow ? { x: w * 0.3, y: h * 0.22, s: 0.22 } : { x: -w * 0.33, y: chuteY(0.4), s: 0.4 };
    const mathPose: Pose = narrow ? { x: w * 0.32, y: h * 0.24, s: 0.2 } : { x: w * 0.33, y: chuteY(0.38), s: 0.38 };
    const safePose: Pose = narrow ? { x: w * 0.28, y: h * 0.2, s: 0.22 } : { x: -w * 0.31, y: chuteY(0.41), s: 0.41 };

    // Blend hero -> side -> crash.
    const a = ease(clamp01(pilotScroll.hero * 1.4));
    const b = ease(clamp01(pilotScroll.toCrash));
    let x = THREE.MathUtils.lerp(heroPose.x, sidePose.x, a);
    let y = THREE.MathUtils.lerp(heroPose.y, sidePose.y, a);
    let s = THREE.MathUtils.lerp(heroPose.s, sidePose.s, a);
    x = THREE.MathUtils.lerp(x, crashPose.x, b);
    y = THREE.MathUtils.lerp(y, crashPose.y, b);
    s = THREE.MathUtils.lerp(s, crashPose.s, b);

    // Crash: shake while the coin dies, then fire the seat.
    const crash = pilotScroll.crash;
    const dying = clamp01((crash - 0.35) / (LAUNCH_START - 0.35));
    const launch = clamp01((crash - LAUNCH_START) / (1 - LAUNCH_START));
    const shake = dying * (1 - launch) * 0.012;
    x += (Math.random() - 0.5) * shake;
    y += (Math.random() - 0.5) * shake + launch * launch * h * 1.4;
    // Fire up and to the left: the pilot comes back down on the left in "How it works".
    x -= launch * launch * w * 0.45;

    // After the ejection the pilot comes back under a parachute and stays for the rest of the page:
    // it drifts down as "How it works" enters, zig-zags beside every section, then drifts out of the
    // frame as the final call to action comes in.
    let chuteOpen = 0;
    let glide = 0; // 0..1 bump that peaks halfway through each section change (a parachute drift)
    let turn = 0; // one slow spin per section change, in the direction of travel
    const howEl = pilotScroll.howEl;
    const ctaEl = pilotScroll.ctaEl;
    if (howEl && ctaEl) {
      const hr = howEl.getBoundingClientRect();
      if (hr.top < vh) {
        const enter = clamp01((vh - hr.top) / vh);
        // Section changes: as each next section scrolls in, drift across to its pose like a parachutist.
        // Banking, facing the direction of travel and the pendulum swing come from the velocity below.
        let px = howPose.x;
        let py = howPose.y;
        let ps = howPose.s;
        const legs: Array<[HTMLElement | null, Pose, number]> = [
          [pilotScroll.resultsEl, mathPose, 1], // drifts right
          [pilotScroll.safeEl, safePose, -1], // drifts left
        ];
        for (const [el, pose, dir] of legs) {
          if (!el) continue;
          const tt = clamp01((vh - el.getBoundingClientRect().top) / vh);
          if (tt <= 0) continue;
          const d = ease(tt);
          px = THREE.MathUtils.lerp(px, pose.x, d);
          py = THREE.MathUtils.lerp(py, pose.y, d);
          ps = THREE.MathUtils.lerp(ps, pose.s, d);
          glide += Math.sin(Math.PI * tt);
          turn += d * Math.PI * 2 * dir;
        }
        x = px;
        // Sink a little in the middle of each drift, then flare back up, like a canopy turning.
        y = THREE.MathUtils.lerp(h * 1.15, py, ease(enter)) - glide * h * 0.06;
        s = ps;
        chuteOpen = clamp01(enter / 0.35);

        // Final call to action stays clean: as it scrolls in, the wind carries the pilot off to the
        // right and down, out of the frame, before the section fills the screen.
        const cr = ctaEl.getBoundingClientRect();
        const exit = clamp01((vh - cr.top) / (vh * 0.75));
        if (exit > 0) {
          const d = exit * exit;
          x += d * w * 1.05;
          y -= d * h * 0.8;
        }
      }
    }
    const underChute = chuteOpen > 0;
    // Legs: a small idle swing, a bigger dangle under the parachute.
    LEGS.uKick.value = THREE.MathUtils.damp(LEGS.uKick.value, underChute ? 0.38 : 0.14, 3, delta);
    const sway = underChute ? Math.sin(t * 1.3) * 0.05 : 0;
    if (chute.current) {
      chute.current.visible = underChute;
      const k = 0.3 + chuteOpen * 0.7;
      chute.current.scale.set(k, k, k);
    }

    // Ease toward the target pose, and measure the horizontal speed of the eased motion.
    const prevX = g.position.x;
    g.position.x = THREE.MathUtils.damp(g.position.x, x, 6, delta);
    const bob = Math.sin(t * 1.1) * 0.03;
    g.position.y = THREE.MathUtils.damp(g.position.y, y + bob, 6, delta);
    const sc = THREE.MathUtils.damp(g.scale.x, s, 6, delta);
    g.scale.setScalar(sc);
    const m = motion.current;
    const vx = (g.position.x - prevX) / Math.max(delta, 1e-3);
    m.vx = THREE.MathUtils.damp(m.vx, vx, 8, delta);

    // Bank into the direction of travel with a pendulum spring (the seat hangs under the canopy,
    // so it leans, overshoots and settles). Weaker without the parachute.
    const rollTarget = THREE.MathUtils.clamp(-m.vx * 0.22, -0.25, 0.25) * (underChute ? 1 : 0.4);
    m.rollV += (28 * (rollTarget - m.roll) - 3.2 * m.rollV) * delta;
    m.roll += m.rollV * delta;

    // Facing: outside the hero the pilot always looks at the section content, which sits on the other
    // side of the screen (pilot on the right looks left, pilot on the left looks right). The hero keeps
    // its free three-quarter pose. While drifting, it also turns toward where it is going.
    const inHero = 1 - a;
    const lookYaw = -THREE.MathUtils.clamp(g.position.x / (w * 0.15), -1, 1) * 0.8;
    let restYaw = THREE.MathUtils.lerp(lookYaw, -0.35, inHero);
    // The Crash: follow the chart's moving head. It starts far left and travels right toward the pilot,
    // so the gaze turns from hard left toward the middle as the days go by.
    const chartT = ease(clamp01(pilotScroll.crash / DRAW_END));
    const crashLook = THREE.MathUtils.lerp(-0.9, -0.08, chartT);
    restYaw = THREE.MathUtils.lerp(restYaw, crashLook, b * (1 - chuteOpen));
    const travelYaw = THREE.MathUtils.clamp(m.vx * 0.7, -1.1, 1.1);

    // Drag to spin (mouse only). Keeps some inertia, then eases back to the choreographed angle.
    const u = drag.current;
    if (!u.dragging) {
      u.rotY += u.vel * delta;
      u.vel *= Math.exp(-2.5 * delta);
      u.idle += delta;
      if (u.idle > 1.2) {
        const home = Math.round(u.rotY / (Math.PI * 2)) * Math.PI * 2;
        u.rotY = THREE.MathUtils.damp(u.rotY, home, 2.5, delta);
        u.rotX = THREE.MathUtils.damp(u.rotX, 0, 2.5, delta);
      }
    }

    // Rotation: facing, a spin through the statement that ends facing the text, pointer tilt, user drag, launch lean.
    // The Problem: one slow spin while the text types, ending turned to face the text on its left.
    // The spin finishes when the section fills the screen (statement progress 0.5), same moment the typing ends.
    const spin = ease(clamp01((pilotScroll.statement - 0.1) / 0.4)) * Math.PI * 2 * (1 - b);
    // The pointer only nudges the gaze outside the hero, so the pilot keeps looking at the content.
    const pointerWeight = THREE.MathUtils.lerp(0.08, 0.3, inHero);
    const targetY = restYaw + travelYaw + spin + turn + state.pointer.x * pointerWeight;
    // On the crash chart, lean in a little toward the chart below.
    const lookDown = b * (1 - launch) * (1 - chuteOpen) * 0.16;
    const targetX = -state.pointer.y * pointerWeight * 0.4 + lookDown;
    m.yaw = THREE.MathUtils.damp(m.yaw, targetY, 4, delta);
    g.rotation.y = m.yaw + u.rotY;
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, targetX + u.rotX, 4, delta);
    // Launch: lean up and to the left, along the thrust.
    g.rotation.z = m.roll + Math.sin(t * 0.8) * 0.02 + (underChute ? 0 : launch * 0.45) + sway;

    if (flames.current) {
      // Rockets burn out once the parachute is out.
      flames.current.visible = !underChute;
      const f = 1 + Math.sin(t * 38) * 0.1 + Math.random() * 0.08;
      flames.current.scale.set(1 + launch * 0.6, f * (1 + launch * 3.5), 1 + launch * 0.6);
    }
  });

  // Drag handlers: grab the pilot with the mouse and spin it.
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.pointerType !== "mouse") return;
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    const u = drag.current;
    u.dragging = true;
    u.lastX = e.clientX;
    u.lastY = e.clientY;
    u.vel = 0;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - u.lastX;
      const dy = ev.clientY - u.lastY;
      u.lastX = ev.clientX;
      u.lastY = ev.clientY;
      u.rotY += dx * 0.012;
      u.rotX = THREE.MathUtils.clamp(u.rotX + dy * 0.006, -0.6, 0.6);
      u.vel = dx * 0.012 * 60;
    };
    const up = () => {
      u.dragging = false;
      u.idle = 0;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <group ref={group}>
      <primitive object={model} />
      {/* Invisible grab handle around the pilot and seat. Only this is hit-tested, not the full model. */}
      <mesh
        onPointerDown={onPointerDown}
        onPointerOver={(e) => {
          if (e.pointerType === "mouse" && !drag.current.dragging) document.body.style.cursor = "grab";
        }}
        onPointerOut={() => {
          if (!drag.current.dragging) document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[0.75, MODEL_HEIGHT, 0.75]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={flames} position={[0, bottom + 0.02, nozzleZ]}>
        <Flame x={-nozzleX} />
        <Flame x={nozzleX} />
        <pointLight position={[0, -0.05, 0.15]} color="#ff7a1f" intensity={3} distance={1.4} />
      </group>
      <group ref={chute} visible={false}>
        <Parachute />
      </group>
    </group>
  );
}

/**
 * Vertex shader helper: bends the lower legs and boots around the knees (object space of the GLB:
 * the pilot faces +z, the knees sit near y = -0.17, z = 0.17). Left and right swing in opposite phase.
 * Used for both positions and normals so the lighting follows the bend.
 */
/** Leg swing uniforms. Module level: there is a single pilot, and the frame loop updates them in place. */
const LEGS = { uTime: { value: 0 }, uKick: { value: 0.12 } };

const LEG_SWING_GLSL = /* glsl */ `
uniform float uTime;
uniform float uKick;
vec3 legSwing(vec3 p0, vec3 v, bool isNormal) {
  float ax = abs(p0.x);
  // Only the boots and shins: skip the eject handle between the knees (center) and the seat frame (sides).
  float w = smoothstep(0.07, 0.17, p0.z) * (1.0 - smoothstep(-0.2, -0.11, p0.y)) * step(-0.49, p0.y)
          * smoothstep(0.035, 0.07, ax) * (1.0 - smoothstep(0.16, 0.2, ax));
  if (w <= 0.0) return v;
  float side = p0.x >= 0.0 ? 1.0 : -1.0;
  float ang = sin(uTime * 3.0 + side * 1.57) * uKick * w;
  float c = cos(ang);
  float s = sin(ang);
  vec3 pivot = isNormal ? vec3(0.0) : vec3(0.0, -0.17, 0.17);
  vec3 q = v - pivot;
  q = vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
  return q + pivot;
}
// "No" head shake (about 15 degrees): the helmet turns around a vertical axis at the neck. The seat back behind the
// helmet (negative z) and the shoulders (below the neck) stay still.
vec3 headShake(vec3 p0, vec3 v, bool isNormal) {
  float w = smoothstep(0.06, 0.14, p0.y) * smoothstep(-0.22, -0.14, p0.z);
  if (w <= 0.0) return v;
  float ang = (sin(uTime * 2.1) * 0.2 + sin(uTime * 0.73 + 1.3) * 0.07) * w;
  float c = cos(ang);
  float s = sin(ang);
  vec3 pivot = isNormal ? vec3(0.0) : vec3(0.0, 0.1, -0.02);
  vec3 q = v - pivot;
  q = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
  return q + pivot;
}
`;

const GORES = 12;
const CANOPY_Y = 1.75; // canopy apex, in model units above the pilot's center (model is 1.35 tall)
const CANOPY_R = 0.85;
const CANOPY_THETA = Math.PI * 0.4;
/** Midpoint between the canopy apex and the bottom of the seat, in model units above the model center. */
const CHUTE_MID = (CANOPY_Y - MODEL_HEIGHT / 2) / 2;
// Suspension lines gather at two links above and beside the helmet, then two risers run
// down behind the helmet to the shoulder harness, like a real ejection seat parachute.
const LINK = { x: 0.3, y: 0.95, z: -0.12 };
const SHOULDER = { x: 0.2, y: 0.12, z: -0.12 };

/** Striped canopy plus rigging lines down to the harness. Built in code, no extra asset. */
function Parachute() {
  const lines = useMemo(() => {
    const rimR = CANOPY_R * Math.sin(CANOPY_THETA);
    const rimY = CANOPY_Y - CANOPY_R * 0.7 + CANOPY_R * Math.cos(CANOPY_THETA) * 0.7;
    const pts: number[] = [];
    for (let i = 0; i < GORES; i++) {
      const a = ((i + 0.5) / GORES) * Math.PI * 2;
      const side = Math.cos(a) >= 0 ? 1 : -1;
      pts.push(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR, side * LINK.x, LINK.y, LINK.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, []);

  return (
    <group>
      <group position={[0, CANOPY_Y - CANOPY_R * 0.7, 0]} scale={[1, 0.7, 1]}>
        {Array.from({ length: GORES }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[CANOPY_R, 4, 10, (i / GORES) * Math.PI * 2, (Math.PI * 2) / GORES, 0, CANOPY_THETA]} />
            <meshStandardMaterial color={i % 2 ? "#ff4d1f" : "#ece8df"} roughness={0.75} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#9a958a" transparent opacity={0.85} />
      </lineSegments>
      {/* Risers: two short straps, drawn as thin boxes so they read thicker than the lines. */}
      {[-1, 1].map((side) => {
        const a = new THREE.Vector3(side * LINK.x, LINK.y, LINK.z);
        const b = new THREE.Vector3(side * SHOULDER.x, SHOULDER.y, SHOULDER.z);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        const angle = Math.atan2(a.x - b.x, a.y - b.y);
        return (
          <mesh key={side} position={mid} rotation={[0, 0, -angle]}>
            <boxGeometry args={[0.025, len, 0.012]} />
            <meshStandardMaterial color="#2a2b30" roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

const FLAME_LAYERS = [
  { r: 0.045, h: 0.26, color: "#ff4d1f", opacity: 0.35 },
  { r: 0.032, h: 0.19, color: "#ffb000", opacity: 0.55 },
  { r: 0.018, h: 0.11, color: "#fff4c4", opacity: 0.9 },
];

function Flame({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]}>
      {FLAME_LAYERS.map((l) => (
        <mesh key={l.color} position={[0, -l.h / 2, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[l.r, l.h, 24, 1, true]} />
          <meshBasicMaterial color={l.color} transparent opacity={l.opacity} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

useGLTF.preload(MODEL_URL);
