/**
 * SingaporeCinematicAtmosphere.ts - Cinematic Sky, Sun & Cloud System for Circuit 3
 * Integrated from PELAGIC Three.js Sky & Ocean Architecture.
 *
 * Technical Specifications:
 * 1. Physical Rayleigh & Mie Atmospheric Scattering Sky (Three.js Sky addon).
 * 2. 6-octave multi-scale procedural noise atlas for cloud advection (DataTexture generated on CPU).
 * 3. Dual-band volumetric-look cloud shader (low stratus + high cirrus) with texture-space advection warping.
 * 4. Analytical solar halo (wide golden aureole + warm incandescent core) blending into atmosphere.
 * 5. Co-aligned directional golden sunlight (0xffbd86, 2.6) and cool sky bounce hemisphere light (0x9ccbd7 / 0x06131d).
 * 6. Continuous camera centering to eliminate horizon cutoff and perspective distortion.
 */

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createC3SelectiveBloom, type C3SelectiveBloom } from './SingaporeSelectiveBloom';
import { createC3TrackFloodlights, type C3TrackFloodlights } from './SingaporeTrackFloodlights';
import { SINGAPORE_WAYPOINTS } from './SingaporeWaypoints';

/**
 * Builds a tileable multi-scale noise atlas once on CPU.
 * Sampling this texture in shader is far cheaper than per-pixel 3D noise hashes.
 */
function createCloudNoiseTexture(width = 512, height = 256): THREE.DataTexture {
  let seed = 0x37c4a91;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const grids = [
    { w: 4, h: 3 },
    { w: 8, h: 5 },
    { w: 16, h: 10 },
    { w: 32, h: 20 },
    { w: 64, h: 40 },
    { w: 128, h: 80 },
  ].map((g) => ({ ...g, data: Float32Array.from({ length: g.w * g.h }, random) }));

  const smooth01 = (x: number) => x * x * (3 - 2 * x);

  function sampleGrid(g: { w: number; h: number; data: Float32Array }, u: number, v: number): number {
    u -= Math.floor(u);
    v -= Math.floor(v);
    const x = u * g.w, y = v * g.h;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth01(x - ix), fy = smooth01(y - iy);
    const x0 = ix % g.w, x1 = (ix + 1) % g.w;
    const y0 = iy % g.h, y1 = (iy + 1) % g.h;
    const a = g.data[y0 * g.w + x0], b = g.data[y0 * g.w + x1];
    const c = g.data[y1 * g.w + x0], d = g.data[y1 * g.w + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const n0 = sampleGrid(grids[0], u, v), n1 = sampleGrid(grids[1], u, v);
      const n2 = sampleGrid(grids[2], u, v), n3 = sampleGrid(grids[3], u, v);
      const n4 = sampleGrid(grids[4], u, v), n5 = sampleGrid(grids[5], u, v);

      const r = n0 * 0.45 + n1 * 0.26 + n2 * 0.15 + n3 * 0.08 + n4 * 0.06;
      const g = n1 * 0.04 + n2 * 0.13 + n3 * 0.24 + n4 * 0.30 + n5 * 0.29;
      const b = n2 * 0.06 + n3 * 0.18 + n4 * 0.31 + n5 * 0.45;

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(r * 255);
      data[idx + 1] = Math.round(g * 255);
      data[idx + 2] = Math.round(b * 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const CLOUD_VERTEX_SHADER = /* glsl */`
  varying vec3 vCloudDir;
  void main() {
    vCloudDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform sampler2D uCloudNoise;
  varying vec3 vCloudDir;

  const float PI = 3.141592653589793;

  void main() {
    vec3 d = normalize(vCloudDir);
    float elevation = asin(clamp(d.y, -1.0, 1.0));
    float longitude = atan(d.z, d.x) / (2.0 * PI) + 0.5;
    vec2 uv = vec2(fract(longitude), clamp((elevation + 0.05) / 1.35, 0.0, 1.0));

    // Multi-octave organic advection and wind warping across the celestial canopy
    vec4 warp = texture2D(uCloudNoise, uv * vec2(0.92, 1.15) + vec2(uTime * 0.0018, 0.15 - uTime * 0.0004));
    vec2 warpedUV = uv + (warp.rg - 0.5) * vec2(0.115, 0.055) + vec2(-uTime * 0.0019, 0.0);
    vec4 cloudA = texture2D(uCloudNoise, warpedUV * vec2(1.15, 1.25) + vec2(uTime * 0.0016, 0.0));
    vec4 cloudB = texture2D(uCloudNoise, warpedUV * vec2(2.45, 1.95) + vec2(-uTime * 0.0024, 0.28));

    float lowDensity = cloudA.r * 0.72 + cloudB.g * 0.28;

    // Volumetric cumulus clouds spanning from horizon to high zenith (0° to 75°)
    float cumulusBand = smoothstep(-0.015, 0.065, elevation) * (1.0 - smoothstep(0.85, 1.35, elevation));
    float cumulusShape = smoothstep(0.40, 0.68, lowDensity) * cumulusBand;
    float cumulusAlpha = cumulusShape * 0.76;

    // High cirrus feathering layer
    vec4 highA = texture2D(uCloudNoise, warpedUV * vec2(2.85, 3.4) + vec2(-uTime * 0.0034, 0.45));
    float highDensity = highA.b * 0.75 + highA.g * 0.25;
    float cirrusBand = smoothstep(0.08, 0.22, elevation) * (1.0 - smoothstep(1.10, 1.45, elevation));
    float cirrusShape = smoothstep(0.44, 0.72, highDensity) * smoothstep(0.28, 0.62, highA.g) * cirrusBand;
    float cirrusAlpha = cirrusShape * 0.30;

    float cloudsAlpha = cumulusAlpha + cirrusAlpha * (1.0 - cumulusAlpha);

    vec3 sunDir = normalize(uSunDirection);
    float sunDot = clamp(dot(d, sunDir), -1.0, 1.0);
    float angularDistance = sqrt(max(0.0, 2.0 * (1.0 - sunDot)));

    // Wide atmospheric golden aureole and intense sun core
    float haloWide = exp(-angularDistance * 4.2);
    float haloCore = exp(-angularDistance * 16.0);
    float glowAlpha = clamp(haloWide * 0.28 + haloCore * 0.20, 0.0, 0.45);
    vec3 glowColor = mix(vec3(1.25, 0.42, 0.16), vec3(1.55, 0.95, 0.65), smoothstep(0.005, 0.18, angularDistance));

    // Silver lining forward scattering: strong forward lobe along cloud rim boundaries
    float rimForward = pow(max(0.0, sunDot), 5.0) * 1.6 + pow(max(0.0, sunDot), 20.0) * 2.8;
    float cloudRim = smoothstep(0.38, 0.54, lowDensity) * (1.0 - smoothstep(0.58, 0.74, lowDensity));
    vec3 silverLining = vec3(1.50, 1.10, 0.75) * rimForward * cloudRim;

    float sunward = smoothstep(-0.35, 0.70, sunDot);
    // Dark volumetric belly with deep oceanic ambient bounce
    vec3 cloudShadow = mix(vec3(0.09, 0.13, 0.22), vec3(0.24, 0.18, 0.22), sunward * 0.75);
    // Sun-drenched golden cloud top
    vec3 cloudLit = mix(vec3(0.38, 0.42, 0.54), vec3(1.30, 0.82, 0.50), sunward);
    float cloudTop = smoothstep(0.48, 0.78, lowDensity);
    vec3 lowColor = mix(cloudShadow, cloudLit, 0.20 + 0.80 * cloudTop) + silverLining;
    vec3 highColor = mix(vec3(0.30, 0.36, 0.48), vec3(1.15, 0.78, 0.62), sunward * 0.80);
    highColor *= 0.80 + 0.30 * smoothstep(0.48, 0.75, highDensity);

    vec3 cloudsColor = (lowColor * cumulusAlpha + highColor * cirrusAlpha * (1.0 - cumulusAlpha)) / max(cloudsAlpha, 0.0001);

    vec3 premul = cloudsColor * cloudsAlpha + glowColor * glowAlpha * (1.0 - cloudsAlpha);
    float alpha = cloudsAlpha + glowAlpha * (1.0 - cloudsAlpha);
    if (alpha < 0.005) discard;

    gl_FragColor = vec4(premul / max(alpha, 0.0001), clamp(alpha, 0.0, 0.86));
  }
`;

export class SingaporeCinematicAtmosphere {
  public readonly diagnostics = {
    active: false,
    renders: 0,
    exposure: 1.12,
    keyIntensity: 3.2,
    fillIntensity: 0.55,
    preset: 'Cinematic Ocean Golden Hour UE5',
  };

  private readonly sky: Sky;
  private readonly cloudDome: THREE.Mesh;
  private readonly cloudMaterial: THREE.ShaderMaterial;
  private readonly cloudNoise: THREE.DataTexture;
  private readonly bloom: C3SelectiveBloom;
  private readonly trackLighting: C3TrackFloodlights;

  private scene?: THREE.Scene;
  private previousBefore?: THREE.Scene['onBeforeRender'];
  private previousAfter?: THREE.Scene['onAfterRender'];
  private readonly depth = { value: 0 };
  private time = 0;
  private disposed = false;

  private dirLight?: THREE.DirectionalLight;
  private hemiLight?: THREE.HemisphereLight;
  private readonly sunDirection = new THREE.Vector3();
  private readonly cameraWorld = new THREE.Vector3();

  private readonly before: THREE.Scene['onBeforeRender'] = (...args) => {
    if (this.depth.value++ > 0) return;
    try {
      if (args[2]) this.apply(args[0], args[2] as THREE.Camera);
      this.previousBefore?.apply(this.scene!, args);
    } catch (e) {
      this.depth.value = 0;
      throw e;
    }
  };

  private readonly after: THREE.Scene['onAfterRender'] = (...args) => {
    if (this.depth.value === 0 || --this.depth.value > 0) return;
    const renderer = args[0];
    try {
      if (renderer.getRenderTarget() === null && this.root.userData.c3BloomEnabled !== false) {
        this.bloom.render(renderer, this.root.userData.c3Quality ?? 'low');
      }
    } finally {
      this.diagnostics.renders++;
    }
    this.previousAfter?.apply(this.scene!, args);
  };

  constructor(
    private readonly root: THREE.Group,
    private readonly onQuality?: (quality: 'low' | 'medium' | 'high') => void,
  ) {
    // 1. Physically-tuned low golden-hour sun
    const sunElevation = 10.5;
    const sunAzimuth = 157.0;
    const phi = THREE.MathUtils.degToRad(90 - sunElevation);
    const theta = THREE.MathUtils.degToRad(sunAzimuth);
    this.sunDirection.setFromSphericalCoords(1, phi, theta).normalize();

    // 2. Physical Rayleigh & Mie Atmospheric Scattering Sky
    this.sky = new Sky();
    this.sky.name = 'C3_AtmosphericSky';
    this.sky.scale.setScalar(9000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10000;

    const skyUniforms = this.sky.material.uniforms;
    skyUniforms.turbidity.value = 2.4;
    skyUniforms.rayleigh.value = 3.6;
    skyUniforms.mieCoefficient.value = 0.0045;
    skyUniforms.mieDirectionalG.value = 0.86;
    skyUniforms.sunPosition.value.copy(this.sunDirection);
    this.root.add(this.sky);

    // 3. Procedural Cinematic Clouds with Advection & Halo
    this.cloudNoise = createCloudNoiseTexture(512, 256);
    this.cloudMaterial = new THREE.ShaderMaterial({
      name: 'C3_CinematicCloudMaterial',
      vertexShader: CLOUD_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: this.sunDirection.clone() },
        uCloudNoise: { value: this.cloudNoise },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      blending: THREE.NormalBlending,
    });

    this.cloudDome = new THREE.Mesh(new THREE.SphereGeometry(8200, 64, 48), this.cloudMaterial);
    this.cloudDome.name = 'C3_CloudDome';
    this.cloudDome.frustumCulled = false;
    this.cloudDome.renderOrder = 1;
    this.root.add(this.cloudDome);

    // 4. Post-processing & Lighting Subsystems
    this.bloom = createC3SelectiveBloom();
    this.trackLighting = createC3TrackFloodlights(root, SINGAPORE_WAYPOINTS, 7);
    this.trackLighting.setIntensity(0.0); // Daylight sun provides full illumination

    root.userData.c3Bloom = this.bloom.diagnostics;
    root.userData.c3Environment = {
      preset: 'PELAGIC Cinematic Ocean Golden Hour',
      sunElevationDegrees: sunElevation,
      sunAzimuthDegrees: sunAzimuth,
    };

    root.addEventListener('added', () => {
      if (this.root.parent instanceof THREE.Scene) this.attach(this.root.parent);
    });
    root.addEventListener('removed', () => this.detach());

    if (root.parent instanceof THREE.Scene) {
      this.attach(root.parent);
    }
  }

  public update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.disposed) return;
    this.time += Math.min(dt, 0.1);
    this.cloudMaterial.uniforms.uTime.value = this.time;
  }

  private attach(scene: THREE.Scene): void {
    if (this.scene === scene || this.disposed) return;
    this.detach();
    this.scene = scene;
    this.previousBefore = scene.onBeforeRender;
    this.previousAfter = scene.onAfterRender;
    scene.onBeforeRender = this.before;
    scene.onAfterRender = this.after;
    this.diagnostics.active = true;

    // Cache light references once on attach to eliminate expensive scene.traverse in render loop
    this.dirLight = undefined;
    this.hemiLight = undefined;
    scene.traverse((obj) => {
      if (obj instanceof THREE.DirectionalLight && (obj.castShadow || obj.userData.c3PrimarySun)) {
        this.dirLight = obj;
      } else if (obj instanceof THREE.HemisphereLight) {
        this.hemiLight = obj;
      }
    });

    // Distant subtle coastal horizon mist that matches deep golden-hour atmosphere
    scene.fog = new THREE.Fog(0x425868, 1800, 8500);
  }

  private apply(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    camera.getWorldPosition(this.cameraWorld);

    // Center sky and cloud dome continuously on camera
    this.sky.position.copy(this.cameraWorld);
    this.sky.updateMatrix();
    this.cloudDome.position.copy(this.cameraWorld);
    this.cloudDome.updateMatrix();

    // Cinematic ACES Filmic exposure
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.diagnostics.exposure;

    // Direct and ambient lighting synchronization via cached references (zero scene traversal overhead)
    if (this.dirLight) {
      this.dirLight.color.setHex(0xffc28e);
      this.dirLight.intensity = this.diagnostics.keyIntensity;
    }
    if (this.hemiLight) {
      this.hemiLight.color.setHex(0x7397b8); // Deep oceanic skylight bounce
      this.hemiLight.groundColor.setHex(0x181c22); // Warm road/ground bounce
      this.hemiLight.intensity = this.diagnostics.fillIntensity;
    }

    const quality = (this.root.userData.c3Quality as 'low' | 'medium' | 'high') ?? 'high';
    this.trackLighting.update(camera, quality);
    this.onQuality?.(quality);
  }

  private detach(): void {
    if (this.scene) {
      if (this.scene.onBeforeRender === this.before) this.scene.onBeforeRender = this.previousBefore!;
      if (this.scene.onAfterRender === this.after) this.scene.onAfterRender = this.previousAfter!;
    }
    this.scene = undefined;
    this.previousBefore = undefined;
    this.previousAfter = undefined;
    this.diagnostics.active = false;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    this.bloom.dispose();
    this.trackLighting.dispose();
    this.cloudNoise.dispose();
    this.cloudMaterial.dispose();
    this.cloudDome.geometry.dispose();
    this.sky.material.dispose();
    this.sky.geometry.dispose();
  }
}
