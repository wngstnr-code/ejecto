"use client";

import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CHUTE_MID, Flame, MODEL_HEIGHT, MODEL_URL, normalize, Parachute } from "@/components/pilot/parts";

/** Total length of the scene in seconds. */
const LENGTH = 5.2;

/**
 * The one place the 3D pilot appears in the app: right after a successful EJECT the seat fires up
 * from the bottom of the screen, the canopy opens and the pilot drifts down. Click anywhere to skip.
 * This module is loaded lazily, and it preloads the model as soon as the coin turns ejectable.
 */
export default function EjectMoment({ play, onDone }: { play: boolean; onDone: () => void }) {
  useEffect(() => {
    if (!play) return;
    const t = window.setTimeout(onDone, LENGTH * 1000);
    return () => window.clearTimeout(t);
  }, [play, onDone]);

  if (!play) return null;
  return (
    <div className="fixed inset-0 z-[90] cursor-pointer bg-ink/75 backdrop-blur-sm animate-[fade-in_0.3s_ease-out]" onClick={onDone} role="presentation">
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 3.1], fov: 30 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[2.5, 3, 3]} intensity={2.4} />
        <directionalLight position={[-3, 1, -2]} intensity={1.2} color="#ff4d1f" />
        <Suspense fallback={null}>
          <Flight />
          <Environment resolution={256}>
            <Lightformer form="rect" intensity={3} position={[0, 3, 2]} scale={[6, 2, 1]} />
            <Lightformer form="rect" intensity={2} color="#ffd400" position={[-4, 0, 1]} scale={[2, 6, 1]} />
          </Environment>
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute inset-x-0 bottom-[6%] text-center">
        <p className="display text-6xl text-hazard opacity-0 animate-[pop-in_0.5s_1.6s_cubic-bezier(0.34,1.56,0.64,1)_forwards] sm:text-8xl">
          Ejected
        </p>
        <p className="label mt-4 text-bone opacity-0 animate-[pop-in_0.5s_2s_ease-out_forwards]">Every holder can claim now</p>
      </div>
    </div>
  );
}

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

function Flight() {
  const { scene } = useGLTF(MODEL_URL);
  const viewport = useThree((s) => s.viewport);
  const { model, bottom, nozzleX, nozzleZ } = useMemo(() => {
    const { copy, size, k } = normalize(scene);
    return { model: copy, bottom: -MODEL_HEIGHT / 2, nozzleX: size.x * k * 0.17, nozzleZ: size.z * k * 0.3 };
  }, [scene]);
  const group = useRef<THREE.Group>(null);
  const flames = useRef<THREE.Group>(null);
  const chute = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - start.current;
    const h = viewport.height;

    // 0 to 1.1 s: blast up from below the screen. 1.1 to 1.7 s: canopy opens. Then a slow swaying descent.
    const launch = smooth(0, 1.1, t);
    const open = smooth(1.05, 1.7, t);
    const drift = Math.max(0, t - 1.7);
    const s = 0.5;
    const fromY = -h * 0.75;
    const topY = h * 0.08 - CHUTE_MID * s;
    g.position.y = fromY + (topY - fromY) * (1 - Math.pow(1 - launch, 3)) - drift * h * 0.025;
    g.position.x = Math.sin(drift * 1.4) * 0.06;
    g.rotation.z = Math.sin(drift * 1.4 + 0.6) * 0.09 * open;
    g.rotation.y = -0.35 + (1 - launch) * Math.PI * 2;
    g.scale.setScalar(s);

    if (flames.current) {
      const on = 1 - smooth(0.9, 1.25, t);
      flames.current.visible = on > 0.01;
      flames.current.scale.set(on, on * (1 + Math.sin(t * 60) * 0.15), on);
    }
    if (chute.current) {
      chute.current.visible = open > 0.01;
      const k = Math.max(0.001, open);
      // A quick overshoot as the canopy catches air.
      const pop = k + Math.sin(open * Math.PI) * 0.12;
      chute.current.scale.set(pop, k, pop);
    }
  });

  return (
    <group ref={group}>
      <primitive object={model} />
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

useGLTF.preload(MODEL_URL);
