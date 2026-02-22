'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Edges } from '@react-three/drei';
import * as THREE from 'three';

const w = '#b0b8c4';

function WireBox({ args, position, rotation }: {
  args: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={args} />
      <meshBasicMaterial transparent opacity={0} />
      <Edges color={w} />
    </mesh>
  );
}

function House() {
  const group = useRef<THREE.Group>(null!);

  useFrame((_state, delta) => {
    group.current.rotation.y += delta * 0.7;
  });

  const roofMainGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(1.7, 0.8, 4);
    g.rotateY(Math.PI / 4);
    return g;
  }, []);

  const roofWingGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(1.0, 0.6, 4);
    g.rotateY(Math.PI / 4);
    return g;
  }, []);

  return (
    <Float speed={1.4} rotationIntensity={0.08} floatIntensity={0.25}>
      <group ref={group} scale={0.72}>
        {/* main body */}
        <WireBox args={[2.2, 1.2, 1.5]} position={[0, 0, 0]} />

        {/* main roof */}
        <mesh position={[0, 0.95, 0]} geometry={roofMainGeo}>
          <meshBasicMaterial transparent opacity={0} />
          <Edges color={w} />
        </mesh>

        {/* right wing */}
        <WireBox args={[1.0, 1.0, 1.2]} position={[1.6, -0.1, 0.05]} />

        {/* right wing roof */}
        <mesh position={[1.6, 0.7, 0.05]} geometry={roofWingGeo}>
          <meshBasicMaterial transparent opacity={0} />
          <Edges color={w} />
        </mesh>

        {/* garage */}
        <WireBox args={[0.9, 0.8, 1.3]} position={[-1.55, -0.2, 0.05]} />

        {/* garage roof — flat */}
        <WireBox args={[1.0, 0.06, 1.4]} position={[-1.55, 0.24, 0.05]} />

        {/* front door */}
        <WireBox args={[0.35, 0.65, 0.02]} position={[0, -0.28, 0.76]} />

        {/* front door step */}
        <WireBox args={[0.55, 0.08, 0.2]} position={[0, -0.58, 0.85]} />

        {/* front windows */}
        <WireBox args={[0.38, 0.32, 0.02]} position={[-0.55, 0.18, 0.76]} />
        <WireBox args={[0.38, 0.32, 0.02]} position={[0.55, 0.18, 0.76]} />

        {/* upper window */}
        <WireBox args={[0.3, 0.28, 0.02]} position={[0, 0.55, 0.76]} />

        {/* right wing window */}
        <WireBox args={[0.3, 0.3, 0.02]} position={[1.6, 0.1, 0.66]} />

        {/* garage door */}
        <WireBox args={[0.6, 0.55, 0.02]} position={[-1.55, -0.33, 0.71]} />

        {/* chimney */}
        <WireBox args={[0.2, 0.55, 0.2]} position={[0.5, 1.2, -0.25]} />

        {/* side fence */}
        <WireBox args={[0.06, 0.4, 0.8]} position={[-2.1, -0.4, 0.4]} />
        <WireBox args={[0.06, 0.4, 0.8]} position={[2.2, -0.4, 0.4]} />
      </group>
    </Float>
  );
}

export default function HouseScene() {
  return (
    <div style={{ width: '100%', height: 200, marginBottom: 16 }}>
      <Canvas
        camera={{ position: [0, 1.0, 5.2], fov: 28 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <House />
      </Canvas>
    </div>
  );
}
