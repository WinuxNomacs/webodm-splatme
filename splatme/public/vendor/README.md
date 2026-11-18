# Vendored libraries

The Edit Splats page's 3D view (`../editor/viewer.js`) loads these through the page's import map
(`templates/editor.html`). They are files, not an `npm install` on the server, and they are not built by webpack.
Each comes unchanged from its npm package, checked against the registry's integrity hash. Vet them again before
an upgrade.

| File | Package | From the package | SHA-256 |
|---|---|---|---|
| `spark/spark.module.min.js` | `@sparkjsdev/spark` 2.4.0 (MIT, `spark/LICENSE`) | `dist/spark.module.min.js` | `a2f01f68dbcd5e060d55348f803e509fc789b97904e01b98763fcf0314351aaf` |
| `three/three.module.js` | `three` 0.187.0 (MIT, `three/LICENSE`) | `build/three.module.js` | `104f56145899722094556490d787aae0617cc2fc3382f31df02d724ea1aee341` |
| `three/three.core.js` | `three` 0.187.0 | `build/three.core.js` | `613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578` |
| `three/OrbitControls.js` | `three` 0.187.0 | `examples/jsm/controls/OrbitControls.js` | `e7fca2fe9e7670a828af9b28084669a5909445b7f36f1f26cee9bf8f2961c32c` |
| `three/TransformControls.js` | `three` 0.187.0 | `examples/jsm/controls/TransformControls.js` | `151befe25bb0d68626f9a6b033625b7b0cf6848e39ba71623b7bed8e3df565d6` |
| `three/Pass.js` | `three` 0.187.0 | `examples/jsm/postprocessing/Pass.js` (Spark imports it) | `444b409c235ead986893c472e720da1b779a56985c7d10b279c7944b52bd61c5` |

Check them with `sha256sum` from this folder.
