import { getFace, getResultFace } from "./catalog.js";
import { image as loadImage, isImageLabel } from "./assets.js";

const cache = new Map();
const mounted = new WeakMap();
const preferences = ["system", "colorset", "texture"];

function color(value, fallback) {
    return (Array.isArray(value) ? value[0] : value) || fallback;
}

function element(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

export function closePreview(app) {
    mounted.get(app)?.close();
    mounted.delete(app);
}

export function mountPreview(app, html, catalog, render) {
    const selects = preferences.map((key) => html.querySelector(`select[name="quick-toss.${key}"]`));
    const group = selects[0]?.closest(".form-group");
    if (!group || mounted.get(app)?.group === group) return;
    closePreview(app);

    const panel = element("figure", "quick-toss-preview");
    const fallback = element("div", "quick-toss-preview-fallback");
    const image = element("img", "quick-toss-preview-image");
    image.alt = "";
    image.hidden = true;
    const caption = element("figcaption", "quick-toss-preview-caption");
    const title = element("span", "quick-toss-preview-title");
    const swatches = element("span", "quick-toss-preview-swatches");
    fallback.setAttribute("aria-hidden", "true");
    swatches.setAttribute("aria-hidden", "true");
    caption.append(title, swatches);
    panel.append(fallback, image, caption);
    group.append(panel);

    let visible = false;
    let timer;
    let job;
    function showStill(url) {
        image.src = url;
        image.hidden = false;
        fallback.hidden = true;
    }

    function update() {
        clearTimeout(timer);
        job?.abort();
        if (!visible || !panel.isConnected) return;
        const look = Object.fromEntries(preferences.map((key, index) => [key, selects[index]?.value]));
        if (!look.system) look.system = "standard";
        const die = catalog.previewDie(look.system);
        const appearance = catalog.resolve(die, look);
        const { preset, theme } = appearance;
        const palette = preset?.interior?.palette;
        const body = color(palette?.[1] ?? theme.background, "#354a74");
        const ink = color(theme.foreground, "#fff9eb");
        const edge = color(palette?.[0] ?? theme.edge ?? theme.outline, "#151a2c");
        const label = getFace(preset, die, getResultFace(die, preset));
        title.textContent = `${die.type} preview`;
        fallback.style.backgroundColor = body;
        fallback.style.color = ink;
        fallback.textContent = isImageLabel(label) ? String(die.value) : String(label).slice(0, 12);
        swatches.replaceChildren(...[body, ink, palette?.[2] ?? edge].map((value) => {
            const swatch = element("span", "quick-toss-preview-swatch");
            swatch.style.backgroundColor = value;
            return swatch;
        }));

        const key = JSON.stringify([look, die.type, Boolean(preset)]);
        const cached = cache.get(key);
        if (cached) {
            cache.delete(key);
            cache.set(key, cached);
            showStill(cached);
            return;
        }
        image.hidden = true;
        fallback.hidden = false;
        const { signal } = (job = new AbortController());
        timer = setTimeout(async () => {
            if (isImageLabel(label) && !preset?.atlas) {
                void loadImage(label).then((art) => {
                    if (!art || signal.aborted || fallback.hidden) return;
                    const artImage = art.img.cloneNode();
                    artImage.alt = "";
                    fallback.replaceChildren(artImage);
                });
            }
            try {
                const url = await render({ ...die, ...appearance }, signal);
                if (!url || signal.aborted || !panel.isConnected) return;
                if (cache.size >= 24) cache.delete(cache.keys().next().value);
                cache.set(key, url);
                showStill(url);
            } catch (error) {
                console.debug("Quick Toss | Dice preview unavailable", error);
            }
        }, 140);
    }

    const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        update();
    });
    observer.observe(panel);
    for (const select of selects) select?.addEventListener("change", update);
    mounted.set(app, {
        group,
        close() {
            clearTimeout(timer);
            job?.abort();
            observer.disconnect();
            for (const select of selects) select?.removeEventListener("change", update);
            panel.remove();
        },
    });
}
