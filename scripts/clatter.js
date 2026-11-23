// Offset and duration pairs from Dicer's CC0 dice hit sprite.
const sprite = new URL("../assets/dice-hits.mp3", import.meta.url);
const hits = [
    [[0.207, 0.109], [0.551, 0.069], [0.859, 0.099]],
    [[1.869, 0.077], [2.123, 0.071], [2.359, 0.075]],
    [[3.5183, 0.1025], [3.6708, 0.067], [3.7878, 0.083]],
];
const times = [0.12, 0.19, 0.27, 0.40, 0.46, 0.57];
const volumes = [0.9, 0.65, 0.4];
let buffer;
let loading = false;
let retryAfter = 0;

export async function preloadClatter() {
    if (buffer || loading || Date.now() < retryAfter) return;
    loading = true;
    try {
        const response = await fetch(sprite);
        if (!response.ok) throw new Error(`Dice audio returned HTTP ${response.status}`);
        const decoder = new OfflineAudioContext(1, 1, 48000);
        buffer = await decoder.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
        retryAfter = Date.now() + 10_000;
        console.debug("Quick Toss | Recorded dice sound unavailable", error);
    } finally {
        loading = false;
    }
}

export async function playClatter(diceCount) {
    const audio = game.audio;
    const context = audio?.interface;
    if (!context || audio.globalMute || context.state === "closed") return;
    const started = performance.now();
    try {
        if (context.state !== "running") await context.resume();
        if (document.hidden || audio.globalMute || context.state !== "running") return;
        const elapsed = (performance.now() - started) / 1000;
        if (elapsed > 0.4) return;
        if (!buffer) {
            void preloadClatter();
            await audio.play("sounds/dice.wav", { context });
            return;
        }
        const count = Math.min(diceCount + 2, times.length);
        const when = context.currentTime;
        for (let index = 0; index < count; index++) {
            const level = Math.min(2, Math.floor(index * 3 / count));
            const variants = hits[level];
            const [offset, duration] = variants[Math.floor(Math.random() * variants.length)];
            const time = times[index === count - 1 ? times.length - 1 : index];
            if (time < elapsed) continue;
            const source = context.createBufferSource();
            source.buffer = buffer;
            const gain = context.createGain();
            gain.gain.value = volumes[level];
            source.connect(gain).connect(context.gainNode ?? context.destination);
            source.onended = () => {
                source.disconnect();
                gain.disconnect();
            };
            source.start(when + time - elapsed, offset, duration);
        }
    } catch (error) {
        console.debug("Quick Toss | Dice sound unavailable", error);
    }
}
