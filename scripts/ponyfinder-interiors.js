import { registerInteriorSet } from "./interior-presets.js";

const PANTHEON = "princess-luminaces-guide-to-the-pony-pantheon";
const ASHES = "ponyfinder-from-the-ashes";
const HERITAGES = "best-of-the-best";

// Pattern, tint, glow, and speed from the packs' Living Inside definitions.
const deities = {
    apep: ["motes", "#99371d", "#ffbd55", 0.94],
    blaze: ["fire", "#b93223", "#ffcb70", 1.20],
    "gentle-ripple": ["sound", "#2d82b8", "#92ffe7", 0.79],
    kara: ["motes", "#4f9a44", "#e3ffad", 0.85],
    lashtada: ["blossoms", "#b04478", "#ffcab4", 0.61],
    "moon-princess": ["nebula", "#646cc1", "#d0e2ff", 0.57],
    "princess-luminace": ["arcana", "#955bea", "#f5b8ff", 0.86],
    author: ["ink", "#875288", "#ffdc9c", 0.67],
    "soft-whisper": ["smoke", "#668e91", "#d8f4e8", 0.50],
    "sun-queen": ["corona", "#e79830", "#fff3a6", 0.65],
    "the-night-mare": ["storm", "#713d90", "#eca7ec", 0.91],
    "the-unspoken": ["vortices", "#338b85", "#ffc482", 1.08],
};
const heritages = {
    "dynastic-kirin": ["arcana", "#FFC766", 0.64],
    "highlander-kirin": ["storm", "#CEF4FF", 0.88],
    "tined-kirin": ["prism", "#FFE0A1", 1.02],
    "treetop-kirin": ["motes", "#C1F080", 0.74],
    siren: ["sound", "#86F8E3", 0.94],
};

export function registerPonyfinderInteriors(catalog) {
    const active = (id) => game.modules.get(id)?.active;
    const register = (set) => registerInteriorSet(catalog.api, set);
    if (active(PANTHEON)) {
        for (const [slug, [motion, tint, glow, speed]] of Object.entries(deities)) {
            const id = `${PANTHEON}-deity-${slug}`;
            const base = catalog.interiorSource(id);
            if (!base) continue;
            register({
                ...base, id: `${id}-living`, name: `${base.name} (Living Inside)`,
                interior: { palette: ["#1D1722", tint, glow], motion, speed },
            });
        }
        if (catalog.interiorSource(`${PANTHEON}-deity-princess-luminace`)) {
            register({
                id: `${PANTHEON}-pantheon-living`, name: "Pony Pantheon · All Holy Symbols (Living Inside)",
                group: "Ponyfinder", allDice: false,
                interior: {
                    palette: ["#1D1722", "#29294E", "#C8AAEF"], motion: "arcana", speed: 0.86,
                    mark: `modules/${PANTHEON}/assets/dice/deities/pantheon-symbols.png`, orbit: true,
                },
            });
        }
    }
    if (active(HERITAGES)) {
        for (const [slug, [motion, glow, speed]] of Object.entries(heritages)) {
            const id = `${HERITAGES}-heritage-${slug}`;
            const base = catalog.interiorSource(id);
            if (!base) continue;
            register({
                ...base, id: `${id}-living`, name: `${base.name} (Living Inside)`,
                interior: { palette: ["#1D1722", base.background, glow], motion, speed },
            });
        }
    }
    if (active(ASHES) && catalog.interiorSource(`${ASHES}-ashen-wrap`)) {
        register({
            id: `${ASHES}-ashen-living`, name: "From the Ashes · Ashen (Living Inside)", group: "Ponyfinder",
            foreground: "#FFF0D2", label: `modules/${ASHES}/assets/dice/ashen/natural-20.png`,
            interior: { palette: ["#221A1E", "#51464C", "#9B83ED"], motion: "smoke", speed: 0.44 },
        });
    }
}
