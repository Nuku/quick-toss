import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

export function makeModelLoader(webgl, directory) {
    const draco = new DRACOLoader()
        .setDecoderPath(new URL("draco/gltf/", directory).href).setWorkerLimit(1);
    const ktx = new KTX2Loader()
        .setTranscoderPath(new URL("basis/", directory).href).setWorkerLimit(1).detectSupport(webgl);
    return new GLTFLoader().setCrossOrigin("anonymous")
        .setDRACOLoader(draco).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
}
