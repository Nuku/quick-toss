const images = new Map();
const atlases = new Map();
const imageFile = /\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i;

function route(path) {
    if (/^(?:https?:|data:|blob:|\/\/)/i.test(path)) return path;
    if (path.startsWith("/")) path = path.slice(1);
    return globalThis.foundry?.utils?.getRoute?.(path) ?? path;
}

export function image(path) {
    if (typeof path !== "string" || !path) return Promise.resolve(null);
    if (!images.has(path)) {
        if (images.size >= 128) images.delete(images.keys().next().value);
        images.set(path, new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve({ img });
            img.onerror = () => resolve(null);
            img.src = route(path);
        }));
    }
    return images.get(path);
}

function atlas(path) {
    if (!atlases.has(path)) {
        if (atlases.size >= 16) atlases.delete(atlases.keys().next().value);
        atlases.set(path, fetch(route(path)).then(async (response) => {
            if (!response.ok) return null;
            const data = await response.json();
            if (!data.meta?.image) return null;
            const url = new URL(data.meta.image, response.url);
            const sheet = await image(url.href);
            if (!sheet) return null;
            const entries = Array.isArray(data.frames)
                ? data.frames.map((item) => [item.filename, item]) : Object.entries(data.frames ?? {});
            return new Map(entries.map(([key, item]) => [key, { ...item, img: sheet.img }]));
        }).catch(() => null));
    }
    return atlases.get(path);
}

export async function prepareFaces({ preset, texture }, labels) {
    const presetAtlas = preset?.atlas ? atlas(preset.atlas) : null;
    const textureAtlas = texture?.atlas ? atlas(texture.atlas) : null;
    async function source(path, sheet, isLabel = false) {
        if (typeof path !== "string" || !path) return null;
        const frames = await sheet;
        const frame = frames?.get(path);
        if (frame) return frame;
        return !isLabel || imageFile.test(path) ? image(path) : null;
    }
    const [pattern, backgrounds, artwork] = await Promise.all([
        source(texture?.source, textureAtlas),
        Promise.all(labels.map(({ index }) => source(preset?.backgrounds?.labels?.[index - 1], presetAtlas))),
        Promise.all(labels.map(({ text }) => source(text, presetAtlas, true))),
    ]);
    return pattern || backgrounds.some(Boolean) || artwork.some(Boolean) ? { pattern, backgrounds, artwork } : null;
}

export function isImageLabel(value) {
    return typeof value === "string" && (imageFile.test(value) || value.includes("/"));
}

export function drawImage(context, source, x, y, width, height) {
    if (!source) return;
    const { img, frame, rotated, spriteSourceSize: bounds, sourceSize: original } = source;
    if (!frame) {
        context.drawImage(img, x, y, width, height);
        return;
    }
    const { x: sx, y: sy, w: sw, h: sh } = frame;
    if (bounds && original?.w && original?.h) {
        x += bounds.x / original.w * width;
        y += bounds.y / original.h * height;
        width *= bounds.w / original.w;
        height *= bounds.h / original.h;
    }
    if (rotated) {
        context.save();
        context.translate(x, y + height);
        context.rotate(-Math.PI / 2);
        context.drawImage(img, sx, sy, sh, sw, 0, 0, height, width);
        context.restore();
    } else {
        context.drawImage(img, sx, sy, sw, sh, x, y, width, height);
    }
}

const models = new Map();
let modelLoader;
let modelContext;
export function setModelContext(webgl, directory) {
    modelContext = [webgl, directory];
}

export function loadModel(path) {
    if (typeof path !== "string" || !path) return Promise.resolve(null);
    if (!models.has(path)) {
        // Keep a fixed-size hot cache. A clone may still be on screen after eviction.
        if (models.size >= 16) models.delete(models.keys().next().value);
        modelLoader ??= import("./model-loader.js")
            .then(({ makeModelLoader }) => makeModelLoader(...modelContext));
        models.set(path, modelLoader.then((loader) => loader.loadAsync(route(path)))
            .then(({ scene }) => scene).catch(() => null));
    } else {
        const cached = models.get(path);
        models.delete(path);
        models.set(path, cached);
    }
    return models.get(path);
}
