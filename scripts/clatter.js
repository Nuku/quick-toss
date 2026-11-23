// Offset and duration pairs from Dicer's CC0 dice hit sprite.
const sprite = new URL("../assets/dice-hits.mp3", import.meta.url).href;
const hits = [
    [[0.207, 0.109], [0.551, 0.069], [0.859, 0.099]],
    [[1.869, 0.077], [2.123, 0.071], [2.359, 0.075]],
    [[3.5183, 0.1025], [3.6708, 0.067], [3.7878, 0.083]],
];
const times = [0.12, 0.19, 0.27, 0.40, 0.46, 0.57];
const volumes = [0.9, 0.65, 0.4];
let preloaded = false;
let preload;
let retryAfter = 0;

export function preloadClatter() {
    const audio = game.audio;
    if (!audio || preloaded || preload || Date.now() < retryAfter) return;
    preload = (async () => {
        if (audio.locked) await audio.unlock;
        if (!audio.interface) return;
        const sound = new foundry.audio.Sound(sprite, { forceBuffer: true, context: audio.interface });
        await sound.load();
        preloaded = sound.loaded;
        if (!preloaded) retryAfter = Date.now() + 10_000;
    })().catch((error) => {
        retryAfter = Date.now() + 10_000;
        console.debug("Quick Toss | Recorded dice sound unavailable", error);
    }).finally(() => { preload = undefined; });
}

export function canReplaceCoreSound() {
    return game.audio?.interface?.state === "running" && !game.audio.locked;
}

export async function playClatter(diceCount) {
    const audio = game.audio;
    if (!audio || audio.globalMute) return;
    const started = performance.now();
    try {
        if (audio.locked) await audio.unlock;
        const context = audio.interface;
        if (!context || context.state === "closed" || document.hidden || audio.globalMute) return;
        if (context.state !== "running") await context.resume();
        if (document.hidden || audio.globalMute || context.state !== "running") return;
        const elapsed = () => (performance.now() - started) / 1000;
        if (elapsed() > 0.4) return;
        const playStock = async () => {
            if (!document.hidden && !audio.globalMute && elapsed() <= 0.4) {
                await audio.play("sounds/dice.wav", { context });
            }
        };
        if (!preloaded) {
            preloadClatter();
            await playStock();
            return;
        }

        const count = Math.min(diceCount + 2, times.length);
        const sounds = Array.from({ length: count }, () =>
            new foundry.audio.Sound(sprite, { forceBuffer: true, context }));
        await Promise.all(sounds.map((sound) => sound.load()));
        if (sounds.some((sound) => !sound.loaded)) {
            preloaded = false;
            await playStock();
            return;
        }
        if (document.hidden || audio.globalMute || context.state !== "running") return;
        const age = elapsed();
        if (age > 0.4) return;
        await Promise.all(sounds.map((sound, index) => {
            const level = Math.min(2, Math.floor(index * 3 / count));
            const variants = hits[level];
            const [offset, duration] = variants[Math.floor(Math.random() * variants.length)];
            const time = times[index === count - 1 ? times.length - 1 : index];
            if (time < age) return undefined;
            return sound.play({ offset, duration, delay: time - age, volume: volumes[level] });
        }));
    } catch (error) {
        console.debug("Quick Toss | Dice sound unavailable", error);
    }
}
