import {
    AmbientLight, DirectionalLight, Group, OrthographicCamera, Quaternion, Scene, SRGBColorSpace, Vector3,
    WebGLRenderer, WebGLRenderTarget,
} from "three";
import { planDie } from "./dice.js";
import { setModelContext } from "./assets.js";
import { diceLayout, diceScaleFactor, PREVIEW_HALF_SPAN } from "./scale.js";

const MAX_ON_SCREEN = 24;
const TOSS_MS = 720;
const HOLD_MS = 1900;
const ASSET_BUDGET_MS = 125;
const SPIN = new Quaternion();
const AXIS = new Vector3(0.75, 0.55, 0.36).normalize();
const PREVIEW_SIZE = 512;
const MOTION_BUFFER = { width: 1600, height: 1000 };
const SETTLED_BUFFER = { width: 3840, height: 2160 };

function litScene() {
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1.6));
    const key = new DirectionalLight(0xfff4e4, 1.5);
    key.position.set(-3, 4, 6);
    scene.add(key);
    return scene;
}

export function createRenderer(onTossStart, initialScale) {
    const canvas = document.createElement("canvas");
    const webgl = new WebGLRenderer({
        canvas, alpha: true, antialias: false, powerPreference: "low-power", preserveDrawingBuffer: true,
    });
    setModelContext(webgl, new URL("./", import.meta.url));
    const layer = document.createElement("div");
    layer.id = "quick-toss-layer";
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    layer.append(canvas);
    document.body.append(layer);

    const scene = litScene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 600);
    camera.position.set(0, 0, 300);
    const batches = new Set();
    const slots = new Set();
    let generation = 0;
    let frame = 0;
    let width;
    let height;
    let bufferWidth;
    let bufferHeight;
    let bufferRatio;
    let lost = false;
    let scale = diceScaleFactor(initialScale);

    function resize() {
        if (width === innerWidth && height === innerHeight) return;
        width = innerWidth;
        height = innerHeight;
        Object.assign(camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
        camera.updateProjectionMatrix();
    }

    function resizeBuffer(moving) {
        // The settled image is rendered once and held, so it can use more pixels than the toss.
        const limit = moving ? MOTION_BUFFER : SETTLED_BUFFER;
        const ratio = Math.min(devicePixelRatio, limit.width / width, limit.height / height);
        if (width === bufferWidth && height === bufferHeight && ratio === bufferRatio) return;
        webgl.setDrawingBufferSize(width, height, ratio);
        bufferWidth = width;
        bufferHeight = height;
        bufferRatio = ratio;
    }

    function schedule() {
        if (!frame) frame = requestAnimationFrame(draw);
    }

    function mark(text) {
        const element = document.createElement("span");
        element.className = "quick-toss-result";
        element.textContent = text;
        element.hidden = true;
        layer.append(element);
        return element;
    }

    function release(batch, shown) {
        clearTimeout(batch.expiry);
        batches.delete(batch);
        scene.remove(batch.group);
        batch.overflow?.remove();
        for (const die of batch.dice) {
            slots.delete(die.slot);
            die.badge?.remove();
            die.model.dispose();
        }
        batch.resolve(shown);
    }

    function clear() {
        generation += 1;
        for (const batch of batches) release(batch, false);
        cancelAnimationFrame(frame);
        frame = 0;
        layer.hidden = true;
    }

    function freeSlot() {
        for (let slot = 0; slot < MAX_ON_SCREEN; slot++) {
            if (slots.has(slot)) continue;
            slots.add(slot);
            return slot;
        }
        throw new Error("No free dice slot");
    }

    function position(label, x, y, shown) {
        if (!label) return;
        label.hidden = !shown;
        if (!shown) return;
        label.style.left = `${width * 0.5 + x}px`;
        label.style.top = `${height * 0.5 - y}px`;
    }

    function draw(now) {
        frame = 0;
        if (!batches.size || lost) {
            layer.hidden = true;
            return;
        }
        resize();
        const { columns, lastRow, size } = diceLayout(width, height, scale, Math.max(...slots));
        const spacing = size * 2.2;
        const gridTop = Math.min(height / 2 - size, Math.max(height * 0.11, lastRow * spacing + size - height / 2));
        let moving = false;
        const starting = [];
        const landed = [];
        for (const batch of batches) {
            if (batch.start === undefined) {
                batch.start = now;
                starting.push(batch);
            }
            for (const die of batch.dice) {
                const t = Math.max(0, Math.min(1, (now - batch.start - die.delay) / TOSS_MS));
                if (t < 1) moving = true;
                if (!die.landed) {
                    if (die.revision !== die.assets.revision) {
                        die.revision = die.assets.revision;
                        try {
                            const model = die.plan.build(die.assets.values);
                            die.group.remove(die.model.object);
                            die.model.dispose();
                            die.badge?.remove();
                            die.model = model;
                            die.badge = model.badge == null ? null : mark(model.badge);
                            die.group.add(model.object);
                        } catch (error) {
                            console.debug("Quick Toss | Could not apply a late dice skin", error);
                        }
                    }
                    die.model.setInteriorProgress?.(t);
                    die.landed = t === 1;
                }
                const remaining = 1 - t;
                const turn = remaining ** 2;
                const targetX = ((die.slot % columns) - (columns - 1) / 2) * spacing - width * 0.04;
                const targetY = gridTop - Math.floor(die.slot / columns) * spacing;
                const enterX = die.side * (width / 2 + size * 1.5);
                const bounce = Math.abs(Math.sin(t * Math.PI * 2.5)) * remaining ** 2 * size * 2.45;
                const x = targetX + (enterX - targetX) * remaining ** 3;
                const y = targetY - height * 0.24 * turn + bounce;
                die.group.position.set(x, y, 0);
                die.group.scale.setScalar(size * (1 + bounce / (size * 5)));
                SPIN.setFromAxisAngle(AXIS, die.side * (Math.PI * 2.6 + die.phase) * turn);
                die.group.quaternion.copy(die.model.target).premultiply(SPIN);
                position(die.badge, targetX, targetY - size * 0.66, t === 1);
            }
            const settled = now - batch.start >= TOSS_MS + batch.delay;
            if (!batch.expiry && settled) landed.push(batch);
            position(batch.overflow, -width * 0.04, Math.min(gridTop + size * 1.5, height / 2 - 12), settled);
        }
        try {
            resizeBuffer(moving);
            webgl.render(scene, camera);
        } catch (error) {
            console.warn("Quick Toss | Drawing stopped", error);
            clear();
            return;
        }
        layer.hidden = false;
        for (const batch of starting) {
            if (batch.playSound) onTossStart?.(batch.dice.length);
        }
        for (const batch of landed) {
            batch.resolve(true);
            batch.expiry = setTimeout(() => {
                release(batch, true);
                schedule();
            }, HOLD_MS);
        }
        if (moving) schedule();
    }

    async function toss(specs, sourceCount, playSound = true) {
        if (lost) return false;
        const requestGeneration = generation;
        const requested = specs.slice(0, MAX_ON_SCREEN);
        const plans = requested.map(planDie);
        let budget;
        const assets = plans.map(() => ({ values: [], revision: 0 }));
        await Promise.race([
            Promise.all(plans.flatMap((plan, index) => plan.assets.map((asset, slot) =>
                asset.then((data) => {
                    if (!data) return;
                    assets[index].values[slot] = data;
                    assets[index].revision += 1;
                })))),
            new Promise((resolve) => { budget = setTimeout(resolve, ASSET_BUDGET_MS); }),
        ]).finally(() => clearTimeout(budget));
        if (requestGeneration !== generation || lost || document.hidden) return false;

        let count = Math.min(requested.length, MAX_ON_SCREEN - slots.size);
        if (requested[count - 1]?.pair && requested[count - 1].pair === requested[count]?.pair) count -= 1;
        if (count === 0) return false;
        const group = new Group();
        const dice = [];
        let resolveBatch;
        const completion = new Promise((resolve) => { resolveBatch = resolve; });
        const batch = { dice, group, playSound, resolve: resolveBatch, delay: 0 };
        try {
            const side = Math.random() < 0.5 ? -1 : 1;
            for (let index = 0; index < count; index++) {
                const plan = plans[index];
                const dieAssets = assets[index];
                const model = plan.build(dieAssets.values);
                const dieGroup = new Group();
                dieGroup.add(model.object);
                group.add(dieGroup);
                const delay = Math.min(index * 14, 120);
                dice.push({
                    model, plan, assets: dieAssets, revision: dieAssets.revision,
                    group: dieGroup, side, delay, phase: Math.random() * 2,
                    slot: freeSlot(), badge: model.badge === null || model.badge === undefined ? null : mark(model.badge),
                });
                batch.delay = delay;
            }
            const omitted = sourceCount - requested.slice(0, count)
                .filter((spec) => !spec.pair || spec.type === "d100").length;
            if (omitted > 0) batch.overflow = mark(`+${omitted}`);
            batches.add(batch);
            scene.add(group);
            schedule();
        } catch (error) {
            release(batch, false);
            throw error;
        }
        return completion;
    }

    async function preview(spec, signal) {
        if (lost || signal.aborted) return null;
        const plan = planDie(spec);
        const assets = await Promise.all(plan.assets);
        if (lost || signal.aborted) return null;
        const model = plan.build(assets);
        const previewScene = litScene();
        const span = PREVIEW_HALF_SPAN;
        const eye = new OrthographicCamera(-span, span, span, -span, 0.1, 20);
        eye.position.z = 4;
        const group = new Group();
        group.quaternion.copy(model.target);
        group.add(model.object);
        previewScene.add(group);
        model.setInteriorProgress?.(1);
        const target = new WebGLRenderTarget(PREVIEW_SIZE, PREVIEW_SIZE, { colorSpace: SRGBColorSpace });
        const previousTarget = webgl.getRenderTarget();
        try {
            webgl.setRenderTarget(target);
            webgl.render(previewScene, eye);
            const raw = new Uint8Array(PREVIEW_SIZE ** 2 * 4);
            webgl.readRenderTargetPixels(target, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE, raw);
            if (!raw.some((channel, index) => index % 4 === 3 && channel > 0)) return null;
            const output = document.createElement("canvas");
            output.width = output.height = PREVIEW_SIZE;
            const ctx = output.getContext("2d");
            if (!ctx) return null;
            const pixels = ctx.createImageData(PREVIEW_SIZE, PREVIEW_SIZE);
            const stride = PREVIEW_SIZE * 4;
            for (let row = 0; row < PREVIEW_SIZE; row++) {
                pixels.data.set(raw.subarray(row * stride, (row + 1) * stride), (PREVIEW_SIZE - row - 1) * stride);
            }
            ctx.putImageData(pixels, 0, 0);
            return output.toDataURL();
        } finally {
            webgl.setRenderTarget(previousTarget);
            target.dispose();
            model.dispose();
        }
    }

    canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        lost = true;
        clear();
    });
    canvas.addEventListener("webglcontextrestored", () => { lost = false; });
    window.addEventListener("resize", () => { if (batches.size) schedule(); });
    function setScale(percent) {
        scale = diceScaleFactor(percent);
        if (batches.size) schedule();
    }

    const preload = (spec) => Promise.allSettled(planDie(spec).assets);
    return { toss, clear, preview, setScale, preload };
}
