// Offset and duration pairs from Dicer's CC0 dice hit sprite.
const sprite = new URL("../assets/dice-hits.mp3", import.meta.url);
const hits = [
    [[0.207, 0.109], [0.551, 0.069], [0.859, 0.099]],
    [[1.869, 0.077], [2.123, 0.071], [2.359, 0.075]],
    [[3.5183, 0.1025], [3.6708, 0.067], [3.7878, 0.083]],
];
const times = [0.12, 0.19, 0.27, 0.40, 0.46, 0.57];
let bufferPromise;

export async function playClatter(diceCount) {
    const audio = game.audio;
    const context = audio?.interface;
    if (audio?.globalMute || context?.state !== "running") return;
    const started = performance.now();
    try {
        bufferPromise ??= fetch(sprite).then((response) => {
            if (!response.ok) throw new Error("Missing dice audio");
            return response.arrayBuffer();
        }).then((data) => context.decodeAudioData(data)).catch(() => null);
        const buffer = await bufferPromise;
        const elapsed = (performance.now() - started) / 1000;
        if (!buffer || elapsed > 0.25 || document.hidden || audio.globalMute || context.state !== "running") return;
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
            gain.gain.value = [0.55, 0.38, 0.23][level];
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
