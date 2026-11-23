import { createCatalog } from "./catalog.js";
import { getDice } from "./results.js";

const ID = "quick-toss";
const HIDDEN = "quick-toss-pending";
const preferences = ["system", "colorset", "texture"];
const pending = new Map();
const rollCounts = new WeakMap();
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let enabled = false;
let driver;
let renderer;
let settingsRefresh = false;

function refreshSettings() {
    if (!enabled || settingsRefresh) return;
    settingsRefresh = true;
    queueMicrotask(() => {
        settingsRefresh = false;
        const choices = catalog.choices(game.i18n.localize.bind(game.i18n));
        for (const key of preferences) {
            const config = game.settings.settings.get(`${ID}.${key}`);
            if (!config) continue;
            const saved = game.settings.get(ID, key);
            if (saved && !Object.hasOwn(choices[key], saved)) choices[key][saved] = `${saved} (unavailable)`;
            config.choices = choices[key];
        }
    });
}

const catalog = createCatalog(refreshSettings);
const setting = (key) => game.settings.get(ID, key);
const appearance = () => Object.fromEntries(preferences.map((key) => [key, setting(key)]));

function canAnimate() {
    return enabled && setting("animation") && !document.hidden && !motion.matches && !api.messageHookDisabled;
}

function rendererPromise() {
    driver ??= import("../dist/renderer.js")
        .then(({ createRenderer }) => {
            renderer = createRenderer();
            return renderer;
        })
        .catch((error) => {
            console.warn("Quick Toss | Dice renderer unavailable", error);
            return null;
        });
    return driver;
}

function hide(entry, html) {
    if (!html?.classList || entry.elements.has(html)) return;
    entry.elements.add(html);
    html.classList.add(HIDDEN);
}

function renderedCards(id) {
    return document.querySelectorAll(`[data-message-id="${CSS.escape(id)}"]`);
}

function reveal(entry, shown) {
    if (pending.get(entry.id) !== entry) return;
    pending.delete(entry.id);
    clearTimeout(entry.timeout);
    entry.message._dice3danimating = false;
    const scrollTargets = new Set();
    for (const html of renderedCards(entry.id)) {
        if (html.classList.contains(HIDDEN)) entry.elements.add(html);
    }
    for (const html of entry.elements) {
        const log = html.closest("#chat-log, .chat-log");
        if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 60) scrollTargets.add(log);
        html.classList.remove(HIDDEN);
    }
    for (const log of scrollTargets) log.scrollTop = log.scrollHeight;
    entry.resolve(shown);
    Hooks.callAll("diceSoNiceRollComplete", entry.id);
}

async function toss(dice, count, look, entry) {
    const instance = await rendererPromise();
    if (!instance || !canAnimate() || (entry && pending.get(entry.id) !== entry)) return false;
    return instance.toss(dice.map((die) => ({ ...die, ...catalog.resolve(die, look) })), count);
}

function startChatToss(message, rolls) {
    if (!canAnimate() || !message.isContentVisible || pending.has(message.id)) return;
    const dsn = message.flags?.["dice-so-nice"];
    if (dsn?.enabled === false || dsn?.persistent) return;
    const { dice, count } = getDice(rolls);
    if (!dice.length) return;
    const look = message.getFlag(ID, "appearance");
    const entry = { id: message.id, message, elements: new Set() };
    entry.promise = new Promise((resolve) => { entry.resolve = resolve; });
    pending.set(entry.id, entry);
    message._dice3danimating = true;
    entry.timeout = setTimeout(() => reveal(entry, false), 1800);
    for (const html of renderedCards(entry.id)) hide(entry, html);
    if (message.sound === "sounds/dice.wav") delete message.sound;
    Hooks.callAll("diceSoNiceMessageProcessed", entry.id, { willTrigger3DRoll: true });

    toss(dice, count, look, entry)
        .then((shown) => reveal(entry, shown))
        .catch((error) => {
            console.warn("Quick Toss | Could not show roll", error);
            reveal(entry, false);
        });
}

const api = Object.assign(catalog.api, {
    messageHookDisabled: false,
    isEnabled: canAnimate,
    async waitFor3DAnimationByMessageID(id) {
        // Let the synchronous createChatMessage listeners set the gate first.
        await null;
        return pending.get(id)?.promise ?? true;
    },
    async showForRoll(roll, user = game.user, _synchronize = false, whisper = null, blind = false) {
        if (!canAnimate()) return false;
        if (whisper?.length && !whisper.includes(game.user.id) && (blind || user?.id !== game.user.id)) return false;
        if (blind && !whisper?.includes(game.user.id)) return false;
        const { dice, count } = getDice([roll]);
        return dice.length ? toss(dice, count, user?.id === game.user.id ? appearance() : {}) : false;
    },
});

Hooks.once("init", () => {
    game.settings.register(ID, "animation", {
        name: "Animate dice",
        hint: "Show dice tosses on this device. Reduced-motion preferences also apply.",
        scope: "client", config: true, type: Boolean, default: true,
        onChange: (value) => {
            if (!value) stopAnimations();
            else if (canAnimate()) void rendererPromise();
        },
    });
    const entries = {
        system: ["Dice preset", "The dice set other players see when you roll.", "standard"],
        colorset: ["Dice theme", "Override the preset’s color palette.", ""],
        texture: ["Dice texture", "Override the preset’s surface pattern.", ""],
    };
    for (const [key, [name, hint, defaultValue]] of Object.entries(entries)) {
        game.settings.register(ID, key, {
            name, hint, scope: "user", config: true, type: String, default: defaultValue, choices: {},
        });
    }
});

Hooks.once("ready", () => {
    if (["dice-so-nice", "dicer"].some((id) => game.modules.get(id)?.active) || game.dice3d) {
        ui.notifications.warn("Quick Toss is idle because another dice renderer is active.");
        return;
    }
    enabled = true;
    game.modules.get(ID).api = api;
    game.dice3d = api;
    Hooks.callAll("diceSoNiceInit", api);
    Hooks.callAll("diceSoNiceReady", api);
    refreshSettings();
    if (canAnimate()) {
        if (globalThis.requestIdleCallback) requestIdleCallback(() => void rendererPromise(), { timeout: 2000 });
        else setTimeout(() => void rendererPromise(), 0);
    }
});

Hooks.on("preCreateChatMessage", (message) => {
    if (!enabled || !message.isRoll) return;
    message.updateSource({ [`flags.${ID}.appearance`]: appearance() });
});

Hooks.on("createChatMessage", (message) => {
    if (!enabled) return;
    rollCounts.set(message, message.rolls.length);
    if (message.isRoll) startChatToss(message, message.rolls);
});

Hooks.on("updateChatMessage", (message, changes) => {
    if (!enabled || !Object.hasOwn(changes, "rolls")) return;
    const previous = rollCounts.get(message);
    rollCounts.set(message, message.rolls.length);
    if (previous !== undefined && message.rolls.length > previous) {
        startChatToss(message, message.rolls.slice(previous));
    }
});

Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!enabled) return;
    if (!rollCounts.has(message)) rollCounts.set(message, message.rolls.length);
    const entry = pending.get(message.id);
    if (entry) hide(entry, html);
});

Hooks.on("deleteChatMessage", (message) => {
    const entry = pending.get(message.id);
    if (entry) reveal(entry, false);
});

function stopAnimations() {
    renderer?.clear();
    for (const entry of pending.values()) reveal(entry, false);
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAnimations();
});

motion.addEventListener("change", () => {
    if (motion.matches) stopAnimations();
});
