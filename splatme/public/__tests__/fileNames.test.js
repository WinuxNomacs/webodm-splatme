// On a case-insensitive disk (macOS, Windows: the dev stack's mount, or WebODM's media folder there) an import of
// "./NewTask" can open newTask.js: no two of the plugin's files in a folder may share a name apart from its case or
// extension.
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['build', 'node_modules']);

function clashes(folder){
    const found = [];
    const entries = fs.readdirSync(folder, {withFileTypes: true});
    const byName = new Map();
    for (const entry of entries){
        if (SKIP.has(entry.name)) continue;
        if (entry.isDirectory()){
            found.push(...clashes(path.join(folder, entry.name)));
            continue;
        }
        const key = entry.name.replace(/\.[^.]*$/, "").toLowerCase();
        const stem = entry.name.replace(/\.[^.]*$/, "");
        if (byName.has(key) && byName.get(key).stem !== stem) found.push(path.join(folder, byName.get(key).name) + " / " + entry.name);
        else if (!byName.has(key)) byName.set(key, {stem, name: entry.name});
    }
    return found;
}

test('no two files in a folder have names that differ only in case or extension', () => {
    expect(clashes(ROOT)).toEqual([]);
});
