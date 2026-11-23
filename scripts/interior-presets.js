const TYPES = ["d2", "d4", "d6", "d8", "d10", "d12", "d20", "d100"];

export function registerInteriorSet(api, {
    id, name, group, interior, label, allDice = true, foreground = "#FFF3D7", outline = interior.palette[0],
}) {
    if (api.hasLivingInterior(id)) return;
    api.addSystem({ id, name, group });
    void api.addColorset({
        name: id, description: name, foreground, background: interior.palette[1], outline, visibility: "hidden",
    });
    for (const type of allDice ? TYPES : ["d20"]) {
        const count = type === "d100" ? 10 : Number(type.slice(1));
        const labels = Array.from({ length: count }, (_, index) => {
            const value = index + 1;
            if (type === "d100") return String(value % 10 * 10).padStart(2, "0");
            if (type === "d10") return String(value % 10);
            return String(value);
        });
        if (type === "d20" && label) labels[19] = label;
        api.addDicePreset({ type, system: id, colorset: id, labels, interior });
    }
}
