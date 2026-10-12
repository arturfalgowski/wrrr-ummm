// Postprocessing: tilt-shift (efekt miniatury), winieta i korekcja kolorów — własne shadery GLSL.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TiltShift = {
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uAmount: { value: 1.0 }, uFocus: { value: 0.5 }, uBand: { value: 0.22 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uAmount; uniform float uFocus; uniform float uBand;
    varying vec2 vUv;
    void main(){
      float d = max(0.0, abs(vUv.y - uFocus) - uBand);
      float r = d * d * 9.0 * uAmount;
      vec2 px = r * 5.0 / uRes;
      vec4 c = texture2D(tDiffuse, vUv) * 0.2;
      float w = 0.2;
      for (int i = 1; i <= 4; i++) {
        float f = float(i) * 0.25;
        float k = 0.2 * (1.0 - f * 0.6);
        c += texture2D(tDiffuse, vUv + vec2(0.0,  f) * px * 4.0) * k;
        c += texture2D(tDiffuse, vUv + vec2(0.0, -f) * px * 4.0) * k;
        w += 2.0 * k;
      }
      gl_FragColor = c / w;
    }`,
};
const Grade = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 } },
  vertexShader: TiltShift.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVig; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(p * vec2(1.0, 1.1)));
      c.rgb *= mix(1.0 - uVig, 1.0, v);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.12);                       // lekkie podbicie nasycenia
      c.rgb = mix(c.rgb, c.rgb * vec3(1.03, 1.0, 0.96), 0.6);  // ciepły ton
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const tilt = new ShaderPass(TiltShift);
  composer.addPass(tilt);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(Grade);
  composer.addPass(grade);
  const api = {
    composer, tilt,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr); composer.setSize(w, h);
      tilt.uniforms.uRes.value.set(w * pr, h * pr);
    },
  };
  return api;
}
