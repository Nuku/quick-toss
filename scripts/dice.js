import {
    Box3, BufferGeometry, CanvasTexture, Float32BufferAttribute, Group, Matrix4, Mesh,
    MeshLambertMaterial, Quaternion, SRGBColorSpace, Vector3,
} from "three";
import { drawImage, image, isImageLabel, loadModel, prepareFaces } from "./assets.js";
import { getFace, getResultFace } from "./catalog.js";
import { layouts } from "./layouts.js";
import { installInterior } from "./interior.js";

const Z = new Vector3(0, 0, 1);
const Y = new Vector3(0, 1, 0);
const TILE = 96;
const preparedLayouts = new Map();

function prepareLayout(type) {
    if (preparedLayouts.has(type)) return preparedLayouts.get(type);
    const layout = layouts[type];
    const vertices = layout.vertices.map((xyz) => new Vector3(...xyz));
    const radius = Math.max(...vertices.map((vertex) => vertex.length()));
    for (const vertex of vertices) vertex.divideScalar(radius);
    const faces = layout.faces.map(([indices, index]) => {
        const points = indices.map((id) => vertices[id]);
        const center = points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(points.length);
        const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
        if (normal.dot(center) < 0) {
            normal.negate();
            points.reverse();
        }
        const up = vertices[indices[0]].clone().sub(center).normalize();
        const right = up.clone().cross(normal);
        return { index, points, center, normal, up, right };
    });
    preparedLayouts.set(type, faces);
    return faces;
}

function faceRotation(normal, up) {
    const right = up.clone().cross(normal).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal)).invert();
}

function displayValue(spec) {
    if (spec.type === "d100" || spec.percentile || spec.coin) return getFace(null, spec, getResultFace(spec));
    return String(spec.value);
}

function planFaces(spec) {
    const declaredShape = spec.shape?.baseShape ?? spec.shape?.shape ?? spec.preset?.shape;
    const shape = spec.type === "d100" ? "d10" : spec.type === "df" ? "d6"
        : [declaredShape, spec.type, `d${spec.faces}`].find((name) => Object.hasOwn(layouts, name));
    const supported = Boolean(layouts[shape]);
    const source = prepareLayout(supported ? shape : "d20");
    const resultFace = getResultFace(spec, spec.preset);
    let target = source.findIndex(({ index }) => index === resultFace);
    if (target < 0) target = 0;
    const faces = source.map((face, position) => {
        const standardIndex = face.index ?? 1;
        const index = spec.type === "df" ? (standardIndex - 1) % 3 + 1 : standardIndex;
        const labelIndex = position === target ? resultFace : index;
        const validFace = Number.isInteger(labelIndex) && labelIndex > 0;
        const text = face.index ? (validFace ? getFace(spec.preset, spec, labelIndex) : displayValue(spec)) : "";
        return { ...face, index: labelIndex, text };
    });
    return { faces, target, shape, modelFaceKnown: supported && Boolean(source[target].index)
        && source[target].index === resultFace && shape === (spec.type === "d100" ? "d10" : spec.type) };
}

function modelDie(spec, scene, plan) {
    const clone = scene.clone(true);
    const box = new Box3().setFromObject(clone);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length();
    if (!Number.isFinite(size) || size <= 0) return null;
    const materials = new Map();
    clone.traverse((child) => {
        if (!child.isMesh) return;
        child.frustumCulled = false;
        const simple = (original) => {
            if (!materials.has(original)) materials.set(original, new MeshLambertMaterial({
                color: original.color, map: original.map,
                transparent: original.transparent, opacity: original.opacity,
                alphaTest: original.alphaTest, side: original.side, vertexColors: original.vertexColors,
            }));
            return materials.get(original);
        };
        child.material = Array.isArray(child.material) ? child.material.map(simple) : simple(child.material);
    });
    clone.position.sub(center);
    const normalized = new Group();
    normalized.add(clone);
    normalized.scale.setScalar(2.25 / size);
    const { normal, up } = plan.faces[plan.target];
    const direction = plan.shape === "d4" ? normal.clone().negate() : normal;
    const target = faceRotation(direction, up);
    return {
        object: normalized, target,
        badge: !plan.modelFaceKnown || spec.coin || (spec.type === "d10" && !spec.percentile && spec.value === 10)
            ? displayValue(spec) : null,
        dispose() { for (const material of materials.values()) material.dispose(); },
    };
}

function choice(value, fallback) {
    if (Array.isArray(value)) return value[Math.floor(Math.random() * value.length)] ?? fallback;
    return value ?? fallback;
}

function paintFaces(spec, plan, art, columns, rows) {
    const sheet = document.createElement("canvas");
    sheet.width = columns * TILE;
    sheet.height = rows * TILE;
    const ctx = sheet.getContext("2d");
    if (!ctx) throw new Error("Could not create a dice texture");
    const theme = spec.theme ?? {};
    const background = choice(theme.background, "#354a74");
    const edge = choice(theme.edge, background);
    const foreground = choice(theme.foreground, "#fff9eb");
    const outline = choice(theme.outline, "#151a2c");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let index = 0; index < plan.faces.length; index++) {
        const face = plan.faces[index];
        const x = index % columns * TILE;
        const y = Math.floor(index / columns) * TILE;
        if (!spec.preset?.interior) {
            ctx.fillStyle = face.text ? background : edge;
            ctx.fillRect(x, y, TILE, TILE);
        }
        if (!face.text) continue;
        ctx.save();
        ctx.globalCompositeOperation = spec.texture?.composite ?? "source-over";
        drawImage(ctx, art?.pattern, x, y, TILE, TILE);
        ctx.restore();
        drawImage(ctx, art?.backgrounds[index], x, y, TILE, TILE);
        if (art?.artwork[index]) {
            const scale = Math.max(0.2, Math.min(1, (Number(spec.preset?.labelScale) || 1) * 0.7));
            const margin = (1 - scale) * TILE * 0.5;
            drawImage(ctx, art.artwork[index], x + margin, y + margin, scale * TILE, scale * TILE);
        } else {
            const unavailable = isImageLabel(face.text) || Boolean(spec.preset?.atlas);
            const fallback = index === plan.target ? displayValue(spec) : getFace(null, spec, face.index);
            const text = String(unavailable ? fallback : face.text).slice(0, 12);
            const size = Math.max(12, Math.min(54, 37 * (Number(spec.preset?.fontScale) || 1)));
            ctx.font = `700 ${size}px ${spec.preset?.font ?? theme.font ?? "Arial"}`;
            ctx.strokeStyle = outline;
            ctx.fillStyle = foreground;
            ctx.lineWidth = 3;
            ctx.strokeText(text, x + TILE / 2, y + TILE / 2, TILE * 0.65);
            ctx.fillText(text, x + TILE / 2, y + TILE / 2, TILE * 0.65);
        }
    }
    const texture = new CanvasTexture(sheet);
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter;
    return texture;
}

function proceduralDie(spec, plan, art, mark) {
    // A coin has many thin unnumbered side polygons. All share the last tile.
    const numbered = plan.faces.filter(({ text }) => text);
    const side = plan.faces.find(({ text }) => !text);
    const tiles = side ? [...numbered, side] : numbered;
    const tilePlan = { faces: tiles, target: tiles.indexOf(plan.faces[plan.target]) };
    const columns = Math.min(5, tiles.length);
    const rows = Math.ceil(tiles.length / columns);
    const texture = paintFaces(spec, tilePlan, art, columns, rows);
    const positions = [];
    const normals = [];
    const uv = [];
    for (const face of plan.faces) {
        const tile = tiles.indexOf(face.text ? face : side);
        const dx = tile % columns;
        const dy = Math.floor(tile / columns);
        const extent = Math.max(...face.points.map((point) => {
            const offset = point.clone().sub(face.center);
            return Math.max(Math.abs(offset.dot(face.right)), Math.abs(offset.dot(face.up)));
        }));
        const add = (vertex) => {
            positions.push(...vertex);
            normals.push(...face.normal);
            const offset = vertex.clone().sub(face.center).multiplyScalar(0.46 / extent);
            uv.push((dx + 0.5 + offset.dot(face.right)) / columns, 1 - (dy + 0.5 - offset.dot(face.up)) / rows);
        };
        for (let corner = 1; corner < face.points.length - 1; corner++) {
            add(face.points[0]);
            add(face.points[corner]);
            add(face.points[corner + 1]);
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    const material = new MeshLambertMaterial({ map: texture });
    const interior = spec.preset?.interior && installInterior(material, spec.preset.interior, mark?.img);
    const face = plan.faces[plan.target];
    return {
        object: new Mesh(geometry, material),
        target: faceRotation(face.normal, face.up),
        setInteriorProgress: interior?.setProgress,
        dispose() {
            interior?.dispose();
            geometry.dispose();
            material.dispose();
            texture.dispose();
        },
    };
}

export function planDie(spec) {
    const plan = planFaces(spec);
    const labels = plan.faces.filter(({ text }) => text);
    if (labels.length < plan.faces.length) labels.push({ text: "", index: 0 });
    return {
        assets: [loadModel(spec.preset?.modelFile), prepareFaces(spec, labels), image(spec.preset?.interior?.mark)],
        build([model, art, mark] = []) {
            return (model && modelDie(spec, model, plan)) || proceduralDie(spec, plan, art, mark);
        },
    };
}
