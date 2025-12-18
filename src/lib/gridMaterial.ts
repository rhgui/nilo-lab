import * as THREE from "three"

export type GridMaterialOptions = {
  gridColor?: THREE.ColorRepresentation
  baseColor?: THREE.ColorRepresentation
  scale?: number
  lineWidth?: number
}

export function createGridMaterial(options: GridMaterialOptions = {}) {
  const {
    gridColor = "#ebe6e6",
    baseColor = "#c4c4c4",
    scale = 1.0,
    lineWidth = 1.0,
  } = options

  const mat = new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    // three has this at runtime; TS types lag behind sometimes
    extensions: { derivatives: true } as unknown as THREE.ShaderMaterialParameters["extensions"],
    uniforms: {
      uGridColor: { value: new THREE.Color(gridColor) },
      uBaseColor: { value: new THREE.Color(baseColor) },
      uScale: { value: scale },
      uLineWidth: { value: lineWidth },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      #ifdef GL_OES_standard_derivatives
      #extension GL_OES_standard_derivatives : enable
      #endif

      uniform vec3 uGridColor;
      uniform vec3 uBaseColor;
      uniform float uScale;
      uniform float uLineWidth;

      varying vec3 vWorldPos;

      float gridAA(vec2 coord) {
        vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
        float line = min(g.x, g.y);
        return 1.0 - smoothstep(0.0, uLineWidth, line);
      }

      void main() {
        vec2 p = vWorldPos.xz * uScale;

        float minor = gridAA(p);
        float major = gridAA(p * 0.1) * 0.75;

        float grid = clamp(minor + major, 0.0, 1.0);
        vec3 col = mix(uBaseColor, uGridColor, grid);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })

  return mat
}
