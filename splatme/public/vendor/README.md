# Vendored libraries

The Edit Splats page's 3D view (`../editor/viewer.js`, and `../editor/modelView.js` for the textured model) loads these through the page's import map
(`templates/editor.html`). They are files, not an `npm install` on the server, and they are not built by webpack.
Each comes unchanged from its npm package, checked against the registry's integrity hash, except that Spark's
last line (`//# sourceMappingURL=spark.module.min.js.map`, a map not vendored) is removed. Vet them again before
an upgrade.

| File | Package | From the package | SHA-256 |
|---|---|---|---|
| `spark/spark.module.min.js` | `@sparkjsdev/spark` 2.4.0 (MIT, `spark/LICENSE`) | `dist/spark.module.min.js` | `79b0bef7918cd1bbab98cee3cd37825e2288a26b20f9ff47add366277154ba49` |
| `three/three.module.js` | `three` 0.187.0 (MIT, `three/LICENSE`) | `build/three.module.js` | `104f56145899722094556490d787aae0617cc2fc3382f31df02d724ea1aee341` |
| `three/three.core.js` | `three` 0.187.0 | `build/three.core.js` | `613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578` |
| `three/OrbitControls.js` | `three` 0.187.0 | `examples/jsm/controls/OrbitControls.js` | `e7fca2fe9e7670a828af9b28084669a5909445b7f36f1f26cee9bf8f2961c32c` |
| `three/TransformControls.js` | `three` 0.187.0 | `examples/jsm/controls/TransformControls.js` | `151befe25bb0d68626f9a6b033625b7b0cf6848e39ba71623b7bed8e3df565d6` |
| `three/Pass.js` | `three` 0.187.0 | `examples/jsm/postprocessing/Pass.js` (Spark imports it) | `444b409c235ead986893c472e720da1b779a56985c7d10b279c7944b52bd61c5` |
| `three/loaders/GLTFLoader.js` | `three` 0.187.0 | `examples/jsm/loaders/GLTFLoader.js` | `532ac726e120039acbcd6cf54328c57acbf7b438176afaa6951257126d11bff1` |
| `three/loaders/DRACOLoader.js` | `three` 0.187.0 | `examples/jsm/loaders/DRACOLoader.js` | `344684542690b7381d86970bbc428a87c89293730f9e9ec8be592b9e5b3263a9` |
| `three/utils/BufferGeometryUtils.js` | `three` 0.187.0 | `examples/jsm/utils/BufferGeometryUtils.js` (GLTFLoader imports it) | `7bda2a8ba836b2bcf67cb938d4b9e1bb5d1b1bc616817103ed858c0b58296ce7` |
| `three/utils/SkeletonUtils.js` | `three` 0.187.0 | `examples/jsm/utils/SkeletonUtils.js` (GLTFLoader imports it) | `b1632a703206c3d830de9fcbe515696770d04b71a15ee6b50afa6d2c3298c86f` |
| `draco/draco_decoder.wasm` | `three` 0.187.0 (Draco, Apache-2.0, `draco/LICENSE`) | `examples/jsm/libs/draco/gltf/draco_decoder.wasm` | `a680d927bed9cb864ddbd63521868891af2bfbe755092761b4837487618df8ac` |
| `draco/draco_wasm_wrapper.js` | `three` 0.187.0 (Draco) | `examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js` | `8bb2952d2ba7d67e1414f8df819410cb0434a666be53f671fff75f68843d76f6` |

WebODM's own Draco decoder (`/static/app/js/vendor/draco`) is older than three.js 0.187's `DRACOLoader` expects
("Unexpected geometry type"), hence the decoder from the same three.js package. `draco/LICENSE` is Draco's,
from https://github.com/google/draco.

Check them with `sha256sum` from this folder. The three.js tarball was checked against the registry's integrity
hash (`sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==`).
