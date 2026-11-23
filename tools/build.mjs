import { build } from "esbuild";
import { copyFile, mkdir, readdir, unlink } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
await mkdir(dist, { recursive: true });
for (const entry of await readdir(dist, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:renderer|chunk-\w+|model-loader-\w+|GLTFLoader-\w+)\.js$/.test(entry.name)) {
        await unlink(new URL(entry.name, dist));
    }
}
await build({
    entryPoints: ["scripts/renderer.js"], bundle: true, splitting: true, format: "esm", target: "es2022",
    minify: true, legalComments: "eof", outdir: "dist", logLevel: "info",
});

const three = new URL("node_modules/three/", root);
const decoders = {
    "draco/gltf": ["draco_wasm_wrapper.js", "draco_decoder.wasm"],
    basis: ["basis_transcoder.js", "basis_transcoder.wasm"],
};
await Promise.all([
    copyFile(new URL("LICENSE", three), new URL("THREE-LICENSE.txt", dist)),
    ...Object.entries(decoders).map(async ([folder, files]) => {
        const destination = new URL(`${folder}/`, dist);
        await mkdir(destination, { recursive: true });
        await Promise.all(files.map((file) => copyFile(
            new URL(`examples/jsm/libs/${folder}/${file}`, three), new URL(file, destination),
        )));
    }),
]);
