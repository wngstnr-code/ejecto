"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { asset } from "@/lib/config";

/** Shared 3D pilot parts: used by the landing stage and by the EJECT moment on the coin page. */
export const MODEL_URL = asset("/mascot/ejecto-pilot.glb");
export const MODEL_HEIGHT = 1.35;

/** Clone a GLB scene, drop its lights and normalize it to MODEL_HEIGHT, centered on the origin. */
export function normalize(scene: THREE.Object3D) {
  const copy = scene.clone(true);
  const lights: THREE.Object3D[] = [];
  copy.traverse((o) => {
    if ((o as THREE.Light).isLight) lights.push(o);
  });
  lights.forEach((l) => l.removeFromParent());
  const box = new THREE.Box3().setFromObject(copy);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const k = MODEL_HEIGHT / size.y;
  copy.scale.setScalar(k);
  copy.position.set(-center.x * k, -center.y * k, -center.z * k);
  return { copy, size, k };
}

const GORES = 12;
const CANOPY_Y = 1.75; // canopy apex, in model units above the pilot's center (model is 1.35 tall)
const CANOPY_R = 0.85;
const CANOPY_THETA = Math.PI * 0.4;
/** Midpoint between the canopy apex and the bottom of the seat, in model units above the model center. */
export const CHUTE_MID = (CANOPY_Y - MODEL_HEIGHT / 2) / 2;
// Suspension lines gather at two links above and beside the helmet, then two risers run
// down behind the helmet to the shoulder harness, like a real ejection seat parachute.
const LINK = { x: 0.3, y: 0.95, z: -0.12 };
const SHOULDER = { x: 0.2, y: 0.12, z: -0.12 };

/** Striped canopy plus rigging lines down to the harness. Built in code, no extra asset. */
export function Parachute() {
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

export function Flame({ x }: { x: number }) {
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
