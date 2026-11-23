import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import test from "node:test";

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
            <button>Unlock audio</button><ol class="chat-log"></ol>`);
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
        window.interiorTimes = [];
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
        window.game = {
            i18n: { localize: (key) => key }, user: { id: "player" },
            modules: new Map([["quick-toss", {}], ["mlp-dice", { active: true }]]),
            settings: {
                settings,
                register: (id, key, config) => settings.set(`${id}.${key}`, config),
                get: (id, key) => values.get(`${id}.${key}`) ?? settings.get(`${id}.${key}`).default,
                set: (id, key, value) => values.set(`${id}.${key}`, value),
            },
        };
        if (nativeAudio) {
            window.CONFIG = { debug: {} };
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
        window.makeMessage = (id, visible = true) => ({
            id, isRoll: true, isContentVisible: visible, flags: {},
            rolls: [{ dice: [{ faces: 20, denomination: "d20", results: [{ result: 20 }] }] }],
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
        window.throwMessage = async (id, system, visible = true, sound = undefined) => {
            game.settings.set("quick-toss", "system", system);
            const message = makeMessage(id, visible);
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
            for (let i = 3; i < pixels.length; i += 4) {
                if (pixels[i]) {
                    opaque += 1;
                    red += pixels[i - 3];
                }
            }
            return { hidden, shown, revealed, revealMs, opaque, red: Math.round(red / opaque),
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
    const standard = await page.evaluate(() => throwMessage("plain", "standard"));
    releaseRecording();
    assert.equal(standard.hidden && standard.shown && standard.revealed, true);
    assert.ok(standard.opaque > 500, "default dice produce visible WebGL pixels");
    assert.ok(standard.revealMs >= 650 && standard.revealMs < 1700, "chat reveals at landing");
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
    const fallback = await page.evaluate(() => throwMessage("fallback", "fallback"));
    assert.equal(fallback.peak, 0, "global mute suppresses clatter");
    assert.equal(fallback.fallbacks, 0, "global mute suppresses stock audio too");
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    if (foundryRoot) await page.evaluate(() => { game.audio.globalMute = false; });
    await page.evaluate(() => throwMessage("warm", "mlp-dice-applejack-skinned"));
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    const skinned = await page.evaluate(() => throwMessage("skin", "mlp-dice-applejack-skinned"));
    assert.equal(skinned.hidden && skinned.shown && skinned.revealed, true);
    assert.ok(skinned.opaque > 500);
    if (foundryRoot) assert.ok(skinned.peak > 0.01, "the recording emits audio on Foundry's interface channel");
    assert.equal(skinned.fallbacks, 0, "loaded clatter replaces stock dice audio");
    assert.notDeepEqual([skinned.opaque, skinned.red], [fallback.opaque, fallback.red],
        "the add-on model renders differently from a procedural die with the same colors");
    assert.ok(requests.some((url) => url.endsWith("/skins/applejack/d20.glb")));

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
    assert.deepEqual(errors, []);
});
