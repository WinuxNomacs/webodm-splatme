// A new task made on SplatMe's Tasks page (NewTask.jsx), sent as WebODM's own New Task panel sends one
// (ProjectListItem.jsx): WebODM's API creates a partial task, SplatMe saves its training setting, the files go
// into the task (a large one in parts, as Dropzone sends it), and WebODM's API commits the task, which starts its
// processing. The setting is saved before any file goes, so it is there whenever the task completes.
//
// send(method, url, body) is the request (api.js's webodm in the page, a stand-in in the tests): it answers the
// JSON, or rejects with an Error whose status is the answer's (none when the server never answered).

// WebODM's accepted files (ProjectListItem.jsx's Dropzone)
export const ACCEPT = "image/*,text/plain,.las,.laz,video/*,.srt,.dng,.nef,.gpx";
export const CONCURRENCY = 3;       // files sent at once
export const RETRIES = 2;           // times a request the server never answered is sent again
export const CHUNK = 8000000;       // the size of a part, as WebODM's own upload (8 MB)
// A proxy's answer while WebODM restarts or is overloaded: as good as none, sent again after a wait
export const GATEWAY_STATUSES = [502, 503, 504];
export const RETRY_WAIT_MS = 3000;

const tasksUrl = projectId => "/api/projects/" + projectId + "/tasks/";

// The fields of WebODM's task creation, from its New Task panel's task info
export function taskData(taskInfo){
    const data = {
        name: taskInfo.name,
        options: taskInfo.options,
        processing_node: taskInfo.selectedNode.id,
        auto_processing_node: taskInfo.selectedNode.key === "auto",
        partial: true,
        align_to: taskInfo.alignTo
    };
    // ResizeModes.YES: WebODM's server resizes the images
    if (taskInfo.resizeMode === 1) data.resize_to = taskInfo.resizeSize;
    return data;
}

// The parts a file of this size is sent in: [{index, offset, end}], one for a file no larger than a part
export function partsOf(size, chunk = CHUNK){
    const count = Math.max(1, Math.ceil(size / chunk));
    const parts = [];
    for (let index = 0; index < count; index++){
        parts.push({index, offset: index * chunk, end: Math.min(size, (index + 1) * chunk)});
    }
    return parts;
}

// send() again when the server never answered it, or its proxy answered for it, up to RETRIES times. Safe: a file
// is kept by its name, and a file sent again from its first part starts over. A cancel is not sent again.
export function retried(send, wait = RETRY_WAIT_MS, attempt = 0){
    return send().catch(e => {
        const gateway = GATEWAY_STATUSES.indexOf(e.status) >= 0;
        if (e.canceled || (e.status && !gateway) || attempt >= RETRIES) throw e;
        return new Promise(resolve => setTimeout(resolve, wait * (attempt + 1))).then(() => retried(send, wait, attempt + 1));
    });
}

// The project a name points to among the projects the user may add a task to, or null when none or several have it
// (the Dashboard's New Task With Splats knows a project by its name only: WebODM's page does not print its id)
export function projectByName(projects, name){
    const wanted = String(name || "").trim();
    const found = (projects || []).filter(p => p.can_train && String(p.name).trim() === wanted);
    return found.length === 1 ? found[0] : null;
}

let uploads = 0;

// One new task's upload. onProgress({sent, total, files, done}) as files go: the bytes and the files sent.
// start() and retry() resolve with the task once it is committed, or reject with the reason, leaving the files that
// did not go in failed (retry() sends those again, and commits); cancel() stops and asks WebODM to remove the task.
export class Upload {
    constructor({projectId, files, send, onProgress, wait}){
        this.projectId = projectId;
        this.files = Array.from(files);
        this.send = send;
        this.onProgress = onProgress || (() => {});
        this.wait = wait == null ? RETRY_WAIT_MS : wait;
        this.task = null;
        this.failed = [];
        this.canceled = false;
        this.total = this.files.reduce((sum, f) => sum + f.size, 0);
        this.sent = 0;
        this.done = 0;
        this.id = "splatme-" + Date.now().toString(36) + "-" + (++uploads);
    }

    // setting: what POST task/<id>/auto is given ({enabled, ...options}), or null for a task not trained by itself
    start(taskInfo, setting){
        return this.send("POST", tasksUrl(this.projectId), taskData(taskInfo)).then(task => {
            if (!task || !task.id) throw new Error("WebODM did not create the task.");
            this.task = task;
            // Canceled while WebODM created it: it goes at once
            if (this.canceled) this.remove();
            this.check();
            if (!setting) return null;
            return this.send("POST", "/api/plugins/splatme/task/" + task.id + "/auto", setting).catch(e => {
                // Without its setting the task would not be trained: it goes, and nothing was uploaded
                return this.remove().then(() => {
                    throw new Error("The task's training setting was not saved, so the task was not created: " + e.message);
                });
            });
        }).then(() => this.sendFiles(this.files));
    }

    retry(){
        const files = this.failed.map(f => f.file);
        this.failed = [];
        return this.sendFiles(files);
    }

    cancel(){
        this.canceled = true;
        return this.remove();
    }

    // WebODM's own way to remove a task (its worker removes a partial task within CLEANUP_PARTIAL_TASKS hours)
    remove(){
        const task = this.task;
        this.task = null;
        if (!task) return Promise.resolve();
        return this.send("POST", tasksUrl(this.projectId) + task.id + "/remove/").catch(() => {});
    }

    check(){
        if (this.canceled) throw Object.assign(new Error("Canceled."), {canceled: true});
    }

    sendFiles(files){
        const queue = files.slice();
        this.report();  // the task exists: the files are on their way
        const worker = () => {
            if (this.canceled || !queue.length) return Promise.resolve();
            const file = queue.shift();
            return this.sendFile(file).catch(e => {
                if (!this.canceled) this.failed.push({file, error: e.message});
            }).then(worker);
        };
        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY, files.length); i++) workers.push(worker());
        return Promise.all(workers).then(() => {
            this.check();
            if (this.failed.length){
                const first = this.failed[0];
                throw new Error(this.failed.length === 1 ? first.file.name + " was not uploaded: " + first.error :
                    this.failed.length + " files were not uploaded (" + first.file.name + ": " + first.error + ")");
            }
            return this.send("POST", tasksUrl(this.projectId) + this.task.id + "/commit/");
        }).then(task => {
            this.check();
            return task;
        });
    }

    // A file in its parts, one after the other. WebODM appends each part to the file's upload, so a part whose answer
    // was lost may have been appended already: the file is sent again from its first part, which WebODM starts
    // afresh, never from the part that failed.
    sendFile(file){
        const url = tasksUrl(this.projectId) + this.task.id + "/upload/";
        const parts = partsOf(file.size);
        const uuid = this.id + "-" + this.done + "-" + Math.random().toString(36).slice(2);
        let sentOfFile = 0;
        const next = i => {
            this.check();
            if (i >= parts.length){
                this.done += 1;
                this.report();
                return Promise.resolve();
            }
            const part = parts[i];
            const form = new FormData();
            if (parts.length > 1){
                form.append("dzuuid", uuid);
                form.append("dzchunkindex", String(part.index));
                form.append("dztotalfilesize", String(file.size));
                form.append("dzchunksize", String(CHUNK));
                form.append("dztotalchunkcount", String(parts.length));
                form.append("dzchunkbyteoffset", String(part.offset));
            }
            form.append("images", parts.length > 1 ? file.slice(part.offset, part.end) : file, file.name);
            return this.send("POST", url, form).then(() => {
                const size = part.end - part.offset;
                sentOfFile += size;
                this.sent += size;
                this.report();
                return next(i + 1);
            });
        };
        // A file sent again starts over: what it had sent no longer counts
        const forget = () => {
            this.sent -= sentOfFile;
            sentOfFile = 0;
            this.report();
        };
        return retried(() => { forget(); return next(0); }, this.wait).catch(e => {
            forget();
            throw e;
        });
    }

    report(){
        this.onProgress({sent: this.sent, total: this.total, files: this.files.length, done: this.done});
    }
}

// Why SplatMe could not train a task of these files, or null: its photos must be JPEG, or all TIFFs (DJI Thermal
// Analyzer's); text files (GCP, geo, image groups) and other files WebODM takes are not photos
const PHOTO = /\.(jpe?g|tiff?|png|dng|nef|raw|webp|bmp|gif|heic)$/i;
export function photoProblem(files){
    const photos = files.map(f => f.name).filter(name => PHOTO.test(name));
    const other = photos.find(name => !/\.(jpe?g|tiff?)$/i.test(name));
    if (other) return "SplatMe trains tasks whose photos are JPEG (or DJI Thermal Analyzer's TIFFs), and " + other + " is neither.";
    if (photos.some(n => /\.jpe?g$/i.test(n)) && photos.some(n => /\.tiff?$/i.test(n))){
        return "SplatMe trains tasks whose photos are all JPEG or all DJI Thermal Analyzer's TIFFs, not both.";
    }
    return null;
}
