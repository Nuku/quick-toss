import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import test from "node:test";

const browserPath = process.env.QUICK_TOSS_BROWSER;
const root = new URL("../", import.meta.url);
const mlp = new URL("../../mlp-dice/", import.meta.url);
const contentTypes = {
    js: "text/javascript", css: "text/css", png: "image/png", glb: "model/gltf-binary",
    wasm: "application/wasm",
};

async function serve(request, response) {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end('<!doctype html><link rel="stylesheet" href="/styles/quick-toss.css"><ol class="chat-log"></ol>');
        return;
    }
    const allowed = /^\/(?:scripts|dist|styles)\/[\w./-]+$/;
    const addon = /^\/modules\/mlp-dice\/(?:scripts|assets)\/[\w./-]+$/;
    if (path.split("/").includes("..") || (!allowed.test(path) && !addon.test(path))) {
        response.writeHead(404).end();
        return;
    }
    try {
        const url = addon.test(path) ? new URL(path.slice("/modules/mlp-dice/".length), mlp)
            : new URL(path.slice(1), root);
        const file = await readFile(url);
        response.writeHead(200, { "Content-Type": contentTypes[path.split(".").at(-1)] ?? "application/octet-stream" });
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
        executablePath: browserPath, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const choices = await page.evaluate(async () => {
        const listeners = new Map();
        const on = (key, callback) => listeners.set(key, [...(listeners.get(key) ?? []), callback]);
        window.Hooks = {
            on, once: on,
            callAll(key, ...args) { for (const callback of listeners.get(key) ?? []) callback(...args); },
        };
        const settings = new Map();
        const values = new Map();
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
        await Promise.all([import("/scripts/main.js"), import("/modules/mlp-dice/scripts/mlp-dice.js")]);
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
        window.throwMessage = async (id, system, visible = true) => {
            game.settings.set("quick-toss", "system", system);
            const message = makeMessage(id, visible);
            Hooks.callAll("preCreateChatMessage", message);
            Hooks.callAll("createChatMessage", message);
            const html = card(message);
            const hidden = getComputedStyle(html).display === "none";
            const shown = await game.dice3d.waitFor3DAnimationByMessageID(id);
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
            return { hidden, shown, revealed, opaque, red: Math.round(red / opaque) };
        };
        return { scope: settings.get("quick-toss.system").scope, presets: settings.get("quick-toss.system").choices };
    });
    assert.equal(choices.scope, "user");
    assert.match(choices.presets["mlp-dice-applejack-skinned"], /Applejack/);
    assert.equal(await page.evaluate(() => getComputedStyle(card(makeMessage("old"))).display === "none"), false);

    const standard = await page.evaluate(() => throwMessage("plain", "standard"));
    assert.equal(standard.hidden && standard.shown && standard.revealed, true);
    assert.ok(standard.opaque > 500, "default dice produce visible WebGL pixels");
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);

    const fallback = await page.evaluate(() => throwMessage("fallback", "fallback"));
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    await page.evaluate(() => throwMessage("warm", "mlp-dice-applejack-skinned"));
    await page.waitForFunction(() => document.querySelector("#quick-toss-layer").hidden);
    const skinned = await page.evaluate(() => throwMessage("skin", "mlp-dice-applejack-skinned"));
    assert.equal(skinned.hidden && skinned.shown && skinned.revealed, true);
    assert.ok(skinned.opaque > 500);
    assert.notDeepEqual([skinned.opaque, skinned.red], [fallback.opaque, fallback.red],
        "the add-on model renders differently from a procedural die with the same colors");
    assert.ok(requests.some((url) => url.endsWith("/skins/applejack/d20.glb")));

    const blind = await page.evaluate(() => throwMessage("blind", "mlp-dice-applejack-skinned", false));
    assert.equal(blind.hidden, false);
    assert.equal(blind.revealed, true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.evaluate(() => throwMessage("reduced", "standard"));
    assert.equal(reduced.hidden, false);
    assert.deepEqual(errors, []);
});
