import { Color, SRGBColorSpace, Texture } from "three";

const marks = new WeakMap();
const patterns = {
    arcana: 0, corona: 0, pulse: 0, sound: 0,
    leaves: 1, bubbles: 1, motes: 1, blossoms: 1,
    prism: 2, storm: 2, sediment: 2,
    fire: 3, smoke: 3, nebula: 3, ink: 3,
    flutter: 4, vortices: 4,
};

// The shader samples a single layer below the face. The label atlas supplies the
// surface ink, and its alpha leaves the interior visible around the result.
const fragment = `
    uniform float uQuickInteriorTime;
    uniform float uQuickInteriorPattern;
    uniform vec3 uQuickInteriorDark;
    uniform vec3 uQuickInteriorTint;
    uniform vec3 uQuickInteriorGlow;
    uniform sampler2D uQuickInteriorMark;
    uniform float uQuickInteriorHasMark;
    uniform float uQuickInteriorOrbit;
    varying vec3 vQuickInteriorPosition;
    varying vec3 vQuickInteriorView;
    varying vec2 vQuickInteriorPlane;

    float quickInteriorDensity(vec3 p, float t) {
        if (uQuickInteriorPattern < 0.5) {
            return smoothstep(-0.1, 0.85, cos(18.0 * length(p.xz) - 4.0 * t) * cos(3.0 * p.y));
        }
        if (uQuickInteriorPattern < 1.5) {
            vec3 drift = p * 4.2 + vec3(0.17 * sin(2.0 * t), 1.7 * t, -t);
            vec3 cell = fract(drift) - 0.5;
            return (1.0 - smoothstep(0.06, 0.34, length(cell))) * (0.7 + 0.3 * cos(4.0 * t + drift.z));
        }
        if (uQuickInteriorPattern < 2.5) {
            return smoothstep(0.45, 0.98, cos(14.0 * p.y + 7.0 * p.z + 4.0 * t + sin(9.0 * p.x)));
        }
        if (uQuickInteriorPattern < 3.5) {
            return smoothstep(-0.35, 0.85, sin(5.5 * p.x + cos(6.0 * p.y - 4.0 * t))
                * cos(7.0 * p.z - 3.0 * t) + 0.25 * cos(11.0 * p.y + t));
        }
        return smoothstep(0.25, 0.94, cos(4.0 * atan(p.z, p.x + 0.001)
            + 12.0 * length(p.xz) - 5.0 * t + 2.5 * p.y));
    }
`;

function acquireMark(image) {
    if (!image) return null;
    if (!marks.has(image)) {
        const texture = new Texture(image);
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        marks.set(image, { texture, refs: 0 });
    }
    const mark = marks.get(image);
    mark.refs += 1;
    return mark.texture;
}

export function installInterior(material, spec, image) {
    const mark = acquireMark(image);
    const time = { value: 0 };
    const speed = Number.isFinite(spec.speed) ? spec.speed : 1;
    const [dark, tint, glow] = spec.palette;

    material.customProgramCacheKey = () => "quick-toss-interior";
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
            uQuickInteriorTime: time,
            uQuickInteriorPattern: { value: patterns[spec.motion] ?? 0 },
            uQuickInteriorDark: { value: new Color(dark) },
            uQuickInteriorTint: { value: new Color(tint) },
            uQuickInteriorGlow: { value: new Color(glow) },
            uQuickInteriorMark: { value: mark ?? material.map },
            uQuickInteriorHasMark: { value: mark ? 1 : 0 },
            uQuickInteriorOrbit: { value: spec.orbit ? 1 : 0 },
        });
        shader.vertexShader = shader.vertexShader.replace("#include <common>", `
            #include <common>
            varying vec3 vQuickInteriorPosition;
            varying vec3 vQuickInteriorView;
            varying vec2 vQuickInteriorPlane;
        `).replace("#include <begin_vertex>", `
            #include <begin_vertex>
            mat3 quickRotation = mat3(modelViewMatrix) / length(modelViewMatrix[0].xyz);
            vQuickInteriorPosition = position;
            vQuickInteriorView = transpose(quickRotation) * vec3(0.0, 0.0, 1.0);
            vQuickInteriorPlane = (quickRotation * position).xy;
        `);
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `
            #include <common>
            ${fragment}
        `).replace("#include <map_fragment>", `
            vec4 ink = texture2D(map, vMapUv);
            vec3 p = vQuickInteriorPosition - vQuickInteriorView * 0.34;
            float radius = length(vQuickInteriorPlane);
            float core = 1.0 - smoothstep(0.22, 0.91, radius);
            float density = quickInteriorDensity(p, uQuickInteriorTime) * core;
            vec3 resin = mix(uQuickInteriorDark, uQuickInteriorTint, 0.38 + 0.38 * core);
            resin = mix(resin, uQuickInteriorGlow, 0.76 * density);
            if (uQuickInteriorHasMark > 0.5) {
                vec2 drift = 0.12 * vec2(sin(3.0 * uQuickInteriorTime), cos(2.5 * uQuickInteriorTime));
                vec2 uv = (vQuickInteriorPlane - drift) / 0.86 + 0.5;
                vec2 tile = vec2(0.0);
                vec2 grid = vec2(1.0);
                if (uQuickInteriorOrbit > 0.5) {
                    const float spacing = 0.52359878;
                    float orbit = uQuickInteriorTime * 1.4;
                    float index = floor((atan(vQuickInteriorPlane.y, vQuickInteriorPlane.x + 0.0001) - orbit)
                        / spacing + 0.5);
                    float angle = index * spacing + orbit;
                    float ring = 0.48 + 0.055 * sin(3.0 * angle + uQuickInteriorTime * 4.0);
                    vec2 center = vec2(cos(angle), sin(angle)) * ring;
                    uv = (vQuickInteriorPlane - center) / 0.22 + 0.5;
                    index = mod(index, 12.0);
                    tile = vec2(mod(index, 4.0), 2.0 - floor(index / 4.0));
                    grid = vec2(4.0, 3.0);
                }
                if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
                    vec4 emblem = texture2D(uQuickInteriorMark, (tile + uv) / grid);
                    resin = mix(resin, emblem.rgb, emblem.a * core * 0.86);
                }
            }
            diffuseColor.rgb *= mix(resin, ink.rgb, ink.a);
        `);
    };
    return {
        setProgress(progress) { time.value = progress * speed; },
        dispose() {
            if (!image) return;
            const entry = marks.get(image);
            entry.refs -= 1;
            if (entry.refs === 0) {
                entry.texture.dispose();
                marks.delete(image);
            }
        },
    };
}
