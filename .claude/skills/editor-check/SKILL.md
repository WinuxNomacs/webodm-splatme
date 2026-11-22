---
name: editor-check
description: Check the Edit page (splats or the 3D model) live in a headless browser on the GPU, against a throwaway copy of a dev task that is deleted afterwards, with timings of the model's preview. Use after a change to the editor (Editor.jsx, editor/viewer.js, editor/modelWorker.js, meshEdits.js, editShapes.js), before committing.
---

# The editor checked live

The dev stack (http://localhost:8008) must be up, and the editor rebuilt after a `.jsx` change
(`docker exec -w /webodm/coreplugins/splatme/public sm-webapp webpack-cli`). A change to `meshes.py` needs
`sm-worker` restarted before an update is checked (only while no WebODM task is processing; see CLAUDE.md).

1. Write a scenario in the session's scratchpad, an ES module whose default export is
   `async ({page, api, copy, at, footer, waitIdle, shot}) => {...}` (see `editorCheck.mjs` for each helper). For example:

   ```js
   export default async ({page, at, waitIdle, shot}) => {
       const t = Date.now();
       await page.locator('.splatme-editor-repairs button', {hasText: /^\s*Move$/}).click();
       await waitIdle('+ a Move box', t);
       await shot('move');
   };
   ```

2. Run it from the repo root (the environment and flags give Chromium the GPU in WSL; without them splats and the
   model render on the CPU and time out):

   ```bash
   GALLIUM_DRIVER=d3d12 LD_LIBRARY_PATH=/usr/lib/wsl/lib MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA \
     node .claude/skills/editor-check/editorCheck.mjs <scenario.mjs> <out dir> [task id] [model edits JSON]
   ```

   It logs in with the dev account from the user's memory (never printed), duplicates the task (the check task by
   default), optionally saves model edits on the copy first, opens its editor on **3D Model**, waits for the tools,
   runs the scenario, prints each preview's timings (`window.__splatmeTiming`) and the page's long tasks, and deletes
   the copy in `finally`. Page errors and console errors (but the expected livereload one) are printed.

3. Look at the screenshots it wrote to the out dir, then delete them and the scenario.

Timings are only comparable on a quiet machine: before a timed run, list the heavy processes and stacks
(`docker stats --no-stream`) and tell the user; stopping another stack is the user's call.
