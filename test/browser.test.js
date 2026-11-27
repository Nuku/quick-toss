import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import test from "node:test";
import { diceLayout } from "../scripts/scale.js";

const browserPath = process.env.QUICK_TOSS_BROWSER;
const foundryPath = process.env.QUICK_TOSS_FOUNDRY_APP;
const foundryRoot = foundryPath ? pathToFileURL(resolve(foundryPath) + sep) : null;
const modulesPath = process.env.QUICK_TOSS_FOUNDRY_MODULES;
const modulesRoot = modulesPath ? pathToFileURL(resolve(modulesPath) + sep) : null;
const packs = [
    ["princess-luminaces-guide-to-the-pony-pantheon", "deity-dice.js"],
    ["ponyfinder-from-the-ashes", "ashen-dice.js"],
    ["best-of-the-best", "heritage-dice.js"],
];
const root = new URL("../", import.meta.url);
const mlp = new URL("../../mlp-dice/", import.meta.url);
const audioFiles = new Map([
    ...["cache", "helper", "sound", "timeout"].map((file) => [
        `/foundry/client/audio/${file}.mjs`, `client/audio/${file}.mjs`,
    ]),
    ["/foundry/client/helpers/hooks.mjs", "client/helpers/hooks.mjs"],
    ["/foundry/common/utils/event-emitter.mjs", "common/utils/event-emitter.mjs"],
    ["/sounds/dice.wav", "public/sounds/dice.wav"],
]);
const contentTypes = {
    js: "text/javascript", mjs: "text/javascript", css: "text/css", png: "image/png",
    glb: "model/gltf-binary", wasm: "application/wasm", mp3: "audio/mpeg", wav: "audio/wav",
};

async function serve(request, response) {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html>
            <script type="importmap">{"imports":{"@client/":"/foundry/client/"}}</script>
            <link rel="stylesheet" href="/styles/quick-toss.css">
            <style>
                .chat-scroll { height: 120px; overflow-y: auto; }
                .chat-log > li { min-height: 100px; }
            </style>
            <button>Unlock audio</button><div class="chat-scroll"><ol class="chat-log"></ol></div>`);
        return;
    }
    if (foundryRoot && path === "/foundry/client/canvas/placeables/tile.mjs") {
        response.writeHead(200, { "Content-Type": "text/javascript" });
        response.end("export default class Tile {}");
        return;
    }
    const allowed = /^\/(?:scripts|dist|styles|assets)\/[\w./-]+$/;
    const addon = /^\/modules\/mlp-dice\/(?:scripts|assets)\/[\w./-]+$/;
    const pack = modulesRoot && /^\/modules\/([\w-]+)\/(?:scripts|assets\/dice)\/[\w./-]+$/.exec(path);
    const installedPack = pack && packs.some(([id]) => id === pack[1]);
    const audioFile = foundryRoot && audioFiles.get(path);
    if (path.split("/").includes("..") || (!audioFile && !allowed.test(path) && !addon.test(path) && !installedPack)) {
        response.writeHead(404).end();
        return;
    }
    try {
        const url = audioFile ? new URL(audioFile, foundryRoot)
            : installedPack ? new URL(path.slice("/modules/".length), modulesRoot)
            : addon.test(path) ? new URL(path.slice("/modules/mlp-dice/".length), mlp)
            : new URL(path.slice(1), root);
        const file = await readFile(url);
        response.writeHead(200, {
            "Content-Type": contentTypes[path.split(".").at(-1)] ?? "application/octet-stream",
            "Content-Length": file.length,
        });
        response.end(file);
    } catch {
        response.writeHead(404).end();
    }
}

test("rolls real MLP dice, gates Foundry-style chat, and preserves blind roll privacy", {
    skip: !browserPath, timeout: 45_000,
}, async (context) => {
    const server = createServer(serve);
    await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    context.after(() => server.close());
    const browser = await chromium.launch({
        executablePath: browserPath,
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    const requests = [];
    let releaseRecording;
    const recordingGate = new Promise((resolve) => { releaseRecording = resolve; });
    await page.route("**/assets/dice-hits.mp3", async (route) => {
        await recordingGate;
        await route.continue();
    });
    context.after(releaseRecording);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error" && message.text().includes("THREE.WebGLProgram")) errors.push(message.text());
    });
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const choices = await page.evaluate(async ({ nativeAudio, installedPacks }) => {
        const listeners = new Map();
        const on = (key, callback) => listeners.set(key, [...(listeners.get(key) ?? []), callback]);
        window.Hooks = {
            on, once: on,
            callAll(key, ...args) { for (const callback of listeners.get(key) ?? []) callback(...args); },
        };
        const settings = new Map();
        const values = new Map();
        const context = WebGL2RenderingContext.prototype;
        const timeLocations = new WeakSet();
        const getLocation = context.getUniformLocation;
        const setFloat = context.uniform1f;
        const readPixels = context.readPixels;
        window.interiorTimes = [];
        window.previewReads = 0;
        context.readPixels = function (x, y, width, height, ...args) {
            if (this.getParameter(this.READ_FRAMEBUFFER_BINDING)) window.previewReads++;
            return readPixels.call(this, x, y, width, height, ...args);
        };
        context.getUniformLocation = function (program, name) {
            const location = getLocation.call(this, program, name);
            if (location && name === "uQuickInteriorTime") timeLocations.add(location);
            return location;
        };
        context.uniform1f = function (location, value) {
            if (timeLocations.has(location)) window.interiorTimes.push(value);
            return setFloat.call(this, location, value);
        };
        let fallbackHits = 0;
        let analyser;
        window.CONFIG = { debug: {}, queries: {} };
        window.game = {
            i18n: { localize: (key) => key }, user: { id: "player" },
            modules: new Map([["quick-toss", {}], ["mlp-dice", { active: true }]]),
            settings: {
                settings,
                register: (id, key, config) => settings.set(`${id}.${key}`, config),
                get: (id, key) => values.get(`${id}.${key}`) ?? settings.get(`${id}.${key}`).default,
                set: (id, key, value) => {
                    const name = `${id}.${key}`;
                    values.set(name, value);
                    settings.get(name)?.onChange?.(value);
                },
            },
        };
        if (nativeAudio) {
            window.ui = {};
            window.canvas = { ready: false };
            Math.clamp = (value, min, max) => Math.min(max, Math.max(min, value));
            for (const key of ["globalPlaylistVolume", "globalAmbientVolume", "globalInterfaceVolume"]) {
                game.settings.set("core", key, 1);
            }
            const [{ default: AudioHelper }, { default: Sound }] = await Promise.all([
                import("/foundry/client/audio/helper.mjs"), import("/foundry/client/audio/sound.mjs"),
            ]);
            window.foundry = {
                audio: { Sound },
                utils: { fetchWithTimeout: (url) => fetch(url), formatFileSize: (value) => String(value) },
            };
            game.audio = new AudioHelper();
            const play = game.audio.play.bind(game.audio);
            game.audio.play = (src, options) => {
                if (src === "sounds/dice.wav") fallbackHits += 1;
                return play(src, options);
            };
            game.audio.unlock.then(() => {
                analyser = game.audio.interface.createAnalyser();
                game.audio.interface.gainNode.connect(analyser);
            });
        }
        for (const [id] of installedPacks) game.modules.set(id, { active: true });
        await Promise.all([
            import("/scripts/main.js"), import("/modules/mlp-dice/scripts/mlp-dice.js"),
            ...installedPacks.map(([id, file]) => import(`/modules/${id}/scripts/${file}`)),
        ]);
        Hooks.callAll("init");
        Hooks.callAll("ready");
        game.dice3d.addSystem({ id: "fallback", name: "Fallback comparison" });
        game.dice3d.addDicePreset({ type: "d20", system: "fallback", colorset: "mlp-dice-applejack-skinned" });
        await null;
        window.makeMessage = (id, visible = true, faces = 20) => ({
            id, isRoll: true, isContentVisible: visible, flags: {},
            rolls: [{ dice: [{ faces, denomination: `d${faces}`, results: [{ result: faces }] }] }],
            updateSource(update) { this.flags["quick-toss"] = { appearance: update["flags.quick-toss.appearance"] }; },
            getFlag(scope, key) { return this.flags[scope]?.[key]; },
        });
        window.card = (message) => {
            const html = document.createElement("li");
            html.dataset.messageId = message.id;
            html.textContent = "Natural 20";
            Hooks.callAll("renderChatMessageHTML", message, html);
            document.querySelector(".chat-log").append(html);
            return html;
        };
        window.throwMessage = async (id, system, visible = true, sound = undefined, faces = 20) => {
            game.settings.set("quick-toss", "system", system);
            const message = makeMessage(id, visible, faces);
            message.sound = sound;
            Hooks.callAll("preCreateChatMessage", message);
            const started = performance.now();
            const previousFallbacks = fallbackHits;
            const samples = analyser && new Float32Array(analyser.fftSize);
            let peak = 0;
            const meter = samples && setInterval(() => {
                analyser.getFloatTimeDomainData(samples);
                for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
            }, 8);
            Hooks.callAll("createChatMessage", message);
            const html = card(message);
            const hidden = getComputedStyle(html).display === "none";
            const shown = await game.dice3d.waitFor3DAnimationByMessageID(id);
            clearInterval(meter);
            const revealMs = performance.now() - started;
            const revealed = getComputedStyle(html).display !== "none";
            const canvas = document.querySelector("#quick-toss-layer canvas");
            const gl = canvas?.getContext("webgl2");
            const pixels = new Uint8Array((canvas?.width ?? 0) * (canvas?.height ?? 0) * 4);
            gl?.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let opaque = 0;
            let red = 0;
            let minX = Infinity;
            let maxX = -1;
            let minY = Infinity;
            let maxY = -1;
            for (let i = 3; i < pixels.length; i += 4) {
                if (pixels[i]) {
                    opaque += 1;
                    red += pixels[i - 3];
                    const pixel = (i - 3) / 4;
                    const x = pixel % canvas.width;
                    const y = Math.floor(pixel / canvas.width);
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
            const dieWidth = opaque ? (maxX - minX + 1) * canvas.clientWidth / canvas.width : 0;
            const dieHeight = opaque ? (maxY - minY + 1) * canvas.clientHeight / canvas.height : 0;
            return { hidden, shown, revealed, revealMs, opaque, red: Math.round(red / opaque),
                dieWidth, dieSpan: Math.max(dieWidth, dieHeight),
                peak, fallbacks: fallbackHits - previousFallbacks, coreSound: message.sound };
        };
        window.firstDiePixels = () => {
            const canvas = document.querySelector("#quick-toss-layer canvas");
            const gl = canvas.getContext("webgl2");
            const pixels = new Uint8Array(72 * 72 * 4);
            // The first slot in this test's 900×600 viewport.
            gl.readPixels(83, 330, 72, 72, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return Array.from(pixels);
        };
        return { scope: settings.get("quick-toss.system").scope, presets: settings.get("quick-toss.system").choices };
    }, { nativeAudio: Boolean(foundryRoot), installedPacks: modulesRoot ? packs : [] });
    assert.equal(choices.scope, "user");
    assert.match(choices.presets["mlp-dice-applejack-skinned"], /Applejack/);
    assert.equal(await page.evaluate(() => getComputedStyle(card(makeMessage("old"))).display === "none"), false);

    if (foundryRoot) {
        assert.equal(await page.evaluate(() => game.audio.locked), true);
        const locked = await page.evaluate(() => throwMessage("locked", "standard", true, "sounds/dice.wav"));
        assert.equal(locked.coreSound, "sounds/dice.wav", "Foundry retains its own cue while audio is locked");
        await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
        await page.getByRole("button", { name: "Unlock audio" }).click();
        await page.waitForFunction(() => game.audio.interface?.state === "running");
    }
    const chat = page.locator(".chat-scroll");
    await chat.evaluate((scroll) => {
        card(makeMessage("older"));
        scroll.scrollTop = scroll.scrollHeight;
    });
    const standard = await page.evaluate(() => throwMessage("plain", "standard"));
    releaseRecording();
    assert.equal(standard.hidden && standard.shown && standard.revealed, true);
    assert.ok(standard.opaque > 500, "default dice produce visible WebGL pixels");
    const slotSpan = 2 * diceLayout(900, 600, 1).size;
    assert.ok(Math.abs(standard.dieSpan - slotSpan) < 2, "the procedural d20 fills its slot");
    assert.ok(standard.revealMs >= 650 && standard.revealMs < 1700, "chat reveals at landing");
    assert.equal(await chat.evaluate((scroll) => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight),
        0, "the revealed roll keeps chat at the bottom");
    if (foundryRoot) {
        assert.equal(standard.fallbacks, 1, "the first toss uses Foundry's stock sound while the recording loads");
        assert.ok(standard.peak > 0.01, "the stock sound emits audio on Foundry's interface channel");
    }
    await page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    assert.equal(await page.locator("#quick-toss-layer").isVisible(), true, "dice linger past the old hold");
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden, null, { timeout: 4000 });

    if (foundryRoot) await page.evaluate(() => { game.audio.globalMute = true; });
    await chat.evaluate((scroll) => { scroll.scrollTop = 0; });
    const fallback = await page.evaluate(() => throwMessage("fallback", "fallback"));
    assert.equal(await chat.evaluate((scroll) => scroll.scrollTop), 0, "revealing a roll preserves scrollback");
    assert.equal(fallback.peak, 0, "global mute suppresses clatter");
    assert.equal(fallback.fallbacks, 0, "global mute suppresses stock audio too");
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    if (foundryRoot) await page.evaluate(() => { game.audio.globalMute = false; });
    let releaseSkin;
    const skinGate = new Promise((resolve) => { releaseSkin = resolve; });
    context.after(releaseSkin);
    await page.route("**/skins/applejack/d20.glb", async (route) => {
        await skinGate;
        await route.continue();
    });
    const firstSkinnedRoll = page.evaluate(() => throwMessage("skin", "mlp-dice-applejack-skinned"));
    await page.locator("#quick-toss-layer").waitFor({ state: "visible" });
    releaseSkin();
    const skinned = await firstSkinnedRoll;
    assert.equal(skinned.hidden && skinned.shown && skinned.revealed, true);
    assert.ok(skinned.opaque > 500);
    assert.ok(Math.abs(skinned.dieSpan - slotSpan) < 2, "the imported d20 fills the same slot");
    if (foundryRoot) assert.ok(skinned.peak > 0.01, "the recording emits audio on Foundry's interface channel");
    assert.equal(skinned.fallbacks, 0, "loaded clatter replaces stock dice audio");
    assert.notDeepEqual([skinned.opaque, skinned.red], [fallback.opaque, fallback.red],
        "the add-on model renders differently from a procedural die with the same colors");
    assert.ok(requests.some((url) => url.endsWith("/skins/applejack/d20.glb")));

    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    const cachedSkin = await page.evaluate(() => throwMessage("cached-skin", "mlp-dice-applejack-skinned"));
    assert.deepEqual([skinned.opaque, skinned.red], [cachedSkin.opaque, cachedSkin.red],
        "the first toss lands with the same skin as the cached toss");
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    await page.waitForFunction(() => game.settings.settings.get("quick-toss.system").choices["mlp-dice-applejack-living"]);
    const living = await page.evaluate(() => throwMessage("living", "mlp-dice-applejack-living"));
    assert.equal(living.hidden && living.shown && living.revealed, true);
    const motionFrames = await page.evaluate(() => window.interiorTimes);
    assert.ok(new Set(motionFrames).size > 3, "the interior changes across rendered toss frames");
    assert.equal(motionFrames.at(-1), 0.55, "the interior reaches the character's landing frame");
    assert.ok(requests.some((url) => url.endsWith("/marks/applejack.png")));
    const frozen = await page.evaluate(() => firstDiePixels());
    assert.ok(frozen.some((value) => value !== 0), "the settled Living Inside die produced visible pixels");
    const nextPreset = modulesRoot ? `${packs[0][0]}-pantheon-living` : "standard";
    const next = await page.evaluate((system) => throwMessage("after-living", system), nextPreset);
    assert.ok(next.opaque > living.opaque);
    assert.deepEqual(await page.evaluate(() => firstDiePixels()), frozen, "another toss preserves the settled interior");

    if (modulesRoot) {
        assert.ok(choices.presets[nextPreset]);
        assert.ok(requests.some((url) => url.endsWith("/deities/pantheon-symbols.png")));
        for (const system of [
            `${packs[0][0]}-deity-princess-luminace-living`,
            `${packs[1][0]}-ashen-living`,
            `${packs[2][0]}-heritage-dynastic-kirin-living`,
        ]) {
            assert.match(choices.presets[system], /Living Inside/);
            const roll = await page.evaluate((preset) => throwMessage(preset, preset), system);
            assert.equal(roll.hidden && roll.shown && roll.revealed, true);
            assert.ok(roll.opaque > 500);
        }
        for (const crest of ["/deities/emblems/princess-luminace.png", "/ashen/natural-20.png", "/heritages/dynastic-kirin.png"]) {
            assert.ok(requests.some((url) => url.endsWith(crest)), crest);
        }
    }
    const blind = await page.evaluate(() => throwMessage("blind", "mlp-dice-applejack-skinned", false));
    assert.equal(blind.hidden, false);
    assert.equal(blind.revealed, true);
    assert.equal(blind.peak, 0);
    assert.equal(blind.fallbacks, 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.evaluate(() => throwMessage("reduced", "standard"));
    assert.equal(reduced.hidden, false);

    await page.evaluate(() => {
        window.settingsApp = {};
        const form = document.createElement("form");
        form.id = "quick-toss-preview-test";
        form.hidden = true;
        for (const key of ["system", "colorset", "texture"]) {
            const group = document.createElement("div");
            group.className = "form-group";
            const select = document.createElement("select");
            select.name = `quick-toss.${key}`;
            const { choices } = game.settings.settings.get(select.name);
            for (const [value, label] of Object.entries(choices)) select.add(new Option(label, value));
            group.append(select);
            form.append(group);
        }
        const scaleGroup = document.createElement("div");
        scaleGroup.className = "form-group";
        const scale = document.createElement("input");
        scale.type = "range";
        scale.name = "quick-toss.diceScale";
        const { range, scope } = game.settings.settings.get(scale.name);
        Object.assign(scale, range, { value: "100" });
        scale.dataset.scope = scope;
        scaleGroup.append(scale);
        form.append(scaleGroup);
        form.elements["quick-toss.system"].value = "mlp-dice-rainbow-dash-skinned";
        document.body.prepend(form);
        Hooks.callAll("renderSettingsConfig", window.settingsApp, form);
    });
    const preview = page.locator(".quick-toss-preview-image");
    const scalePicker = page.locator('[name="quick-toss.diceScale"]');
    const picker = page.locator('select[name="quick-toss.system"]');
    assert.equal(await preview.isVisible(), false);
    assert.ok(!requests.some((url) => url.endsWith("/skins/rainbow-dash/d20.glb")));

    await page.locator("#quick-toss-preview-test").evaluate((form) => { form.hidden = false; });
    await preview.waitFor({ state: "visible" });
    const modelStill = await preview.getAttribute("src");
    assert.match(modelStill, /^data:image\/png;base64,/);
    assert.ok(requests.some((url) => url.endsWith("/skins/rainbow-dash/d20.glb")));
    assert.equal(await scalePicker.getAttribute("data-scope"), "user");
    assert.equal(await scalePicker.locator("..").locator(".quick-toss-preview").count(), 1);
    const normalWidth = (await preview.boundingBox()).width;
    const previewBeforeResize = await page.evaluate(() => previewReads);
    for (const [value, multiplier] of [[50, 0.5], [150, 1.5]]) {
        await scalePicker.evaluate((input, percent) => {
            input.value = String(percent);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
        assert.ok(Math.abs((await preview.boundingBox()).width - normalWidth * multiplier) < 0.05);
        assert.equal(await preview.getAttribute("src"), modelStill);
    }
    assert.equal(await page.evaluate(() => previewReads), previewBeforeResize);
    const beforeInterior = await page.evaluate(() => interiorTimes.length);
    await picker.selectOption("mlp-dice-applejack-living");
    await preview.waitFor({ state: "visible" });
    assert.notEqual(await preview.getAttribute("src"), modelStill);
    assert.deepEqual(await page.evaluate((start) => interiorTimes.slice(start), beforeInterior), [0.55]);
    const rendersBeforeCache = await page.evaluate(() => previewReads);
    await picker.selectOption("mlp-dice-rainbow-dash-skinned");
    assert.equal(await preview.getAttribute("src"), modelStill);
    assert.equal(await page.evaluate(() => previewReads), rendersBeforeCache);
    await picker.selectOption("standard");
    await preview.waitFor({ state: "visible" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const percent of [50, 150]) {
        await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
        if (percent === 150) await page.setViewportSize({ width: 1920, height: 1080 });
        await scalePicker.evaluate((input, value) => {
            input.value = String(value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            game.settings.set("quick-toss", "diceScale", value);
        }, percent);
        const previewWidth = await preview.evaluate(async (img) => {
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = img.naturalWidth;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let minX = Infinity;
            let maxX = -1;
            for (let index = 3; index < data.length; index += 4) {
                if (!data[index]) continue;
                const x = ((index - 3) / 4) % canvas.width;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
            }
            return (maxX - minX + 1) * img.getBoundingClientRect().width / canvas.width;
        });
        assert.equal(await preview.evaluate((img) => img.naturalWidth >= img.clientWidth), true,
            "the settings preview has enough pixels at the selected size");
        const roll = await page.evaluate((value) => throwMessage(`scale-${value}`, "standard"), percent);
        assert.ok(Math.abs(roll.dieWidth - previewWidth) < 3,
            `at ${percent}% the preview is ${previewWidth}px and the settled die is ${roll.dieWidth}px`);
        if (percent === 150) {
            assert.deepEqual(await page.locator("#quick-toss-layer canvas").evaluate((canvas) =>
                [canvas.width, canvas.height]), [1920, 1080], "the landed frame uses full viewport resolution");
        }
    }
    await page.evaluate(() => Hooks.callAll("closeSettingsConfig", window.settingsApp));
    assert.equal(await preview.count(), 0);
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    const cube = await page.evaluate(() => throwMessage("max-d6", "standard", true, undefined, 6));
    assert.ok(Math.abs(cube.dieSpan - 2 * diceLayout(1920, 1080, 1.5).size) < 2,
        "a d6 fills its slot at the maximum setting");
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    const direct = await page.evaluate(async () => {
        const sent = [];
        game.user.active = true;
        game.user.hasPermission = (permission) => permission === "QUERY_USER";
        game.user.constructor = {
            async queryMany(users, name, data) {
                sent.push({ recipients: users.map((user) => user.id), name, value: data.dice[0].value });
            },
        };
        game.users = [game.user, { id: "viewer", active: true }, { id: "gm", isGM: true, active: true },
            { id: "offline" }];
        window.ChatMessage = {
            applyMode(data, mode) {
                data.blind = mode === "blind";
                data.whisper = data.blind ? ["gm"] : [];
            },
        };
        const roll = { dice: [{ faces: 20, denomination: "d20", results: [{ result: 17 }] }] };
        const data = { author: game.user, speaker: { actor: "test" } };
        const blind = await game.dice3d.animateRoll(roll, data, { messageMode: "blind" });
        const hidden = document.querySelector("#quick-toss-layer").hidden;
        const start = performance.now();
        const publicRoll = await game.dice3d.animateRoll(roll, data, { messageMode: "public" });
        return { blind, hidden, publicRoll, elapsed: performance.now() - start, sent };
    });
    assert.equal(direct.blind, false);
    assert.equal(direct.hidden, true);
    assert.equal(direct.publicRoll, true);
    assert.ok(direct.elapsed >= 650, "direct roll promises wait for landing");
    assert.deepEqual(direct.sent, [
        { recipients: ["gm"], name: "quick-toss.animateRoll", value: 17 },
        { recipients: ["viewer", "gm"], name: "quick-toss.animateRoll", value: 17 },
    ]);
    assert.deepEqual(errors, []);
});
