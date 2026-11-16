import { CHUNK, Upload, partsOf, photoProblem, projectByName, retried, taskData } from '../newTask';

const TASKS = "/api/projects/7/tasks/";

function file(name, size){
    return new File([new Uint8Array(size)], name, {type: name.endsWith(".txt") ? "text/plain" : "image/jpeg"});
}

const info = {name: "Field", options: [{name: "fast-orthophoto", value: true}], selectedNode: {id: 3, key: 3}, resizeMode: 0, resizeSize: 2048, alignTo: "auto"};

// A stand-in for WebODM's API: records each request, answers by its URL, and fails the ones told to
function server(failures = {}){
    const calls = [];
    const send = (method, url, body) => {
        const name = body instanceof FormData ? body.get("images").name : null;
        const index = body instanceof FormData ? body.get("dzchunkindex") : null;
        calls.push({method, url, name, index, body});
        const failure = failures[name + "#" + index] || failures[name || url];
        if (failure && failure.times > 0){
            failure.times -= 1;
            const error = new Error(failure.message || "Refused");
            error.status = failure.status;
            return Promise.reject(error);
        }
        if (url === TASKS) return Promise.resolve({id: "abc"});
        if (url.endsWith("/commit/")) return Promise.resolve({id: "abc", partial: false});
        return Promise.resolve({success: true});
    };
    return {calls, send};
}

describe("a new task's fields", () => {
    it("are WebODM's partial task with the processing node and no resize when none is asked", () => {
        expect(taskData(info)).toEqual({name: "Field", options: info.options, processing_node: 3, auto_processing_node: false, partial: true, align_to: "auto"});
    });

    it("ask WebODM's server to resize the images when the panel says so, and to choose the node when it is Auto", () => {
        const data = taskData(Object.assign({}, info, {resizeMode: 1, selectedNode: {id: 3, key: "auto"}}));
        expect(data.resize_to).toBe(2048);
        expect(data.auto_processing_node).toBe(true);
    });
});

describe("a file's parts", () => {
    it("are one for a file no larger than a part, empty files included", () => {
        expect(partsOf(10)).toEqual([{index: 0, offset: 0, end: 10}]);
        expect(partsOf(0)).toEqual([{index: 0, offset: 0, end: 0}]);
    });

    it("cover a larger file end to end in parts of the size", () => {
        expect(partsOf(25, 10)).toEqual([{index: 0, offset: 0, end: 10}, {index: 1, offset: 10, end: 20}, {index: 2, offset: 20, end: 25}]);
    });
});

describe("a request sent again", () => {
    it("is sent again when the server never answered, then gives up", async () => {
        let tries = 0;
        await expect(retried(() => { tries += 1; return Promise.reject(new Error("offline")); }, 0)).rejects.toThrow("offline");
        expect(tries).toBe(3);
    });

    it("is not sent again when the server refused it", async () => {
        let tries = 0;
        const refusal = Object.assign(new Error("bad"), {status: 400});
        await expect(retried(() => { tries += 1; return Promise.reject(refusal); }, 0)).rejects.toThrow("bad");
        expect(tries).toBe(1);
    });

    it("is sent again when a proxy answered for a server that is restarting", async () => {
        let tries = 0;
        const gateway = Object.assign(new Error("gateway"), {status: 502});
        await expect(retried(() => { tries += 1; return tries < 2 ? Promise.reject(gateway) : Promise.resolve("ok"); }, 0)).resolves.toBe("ok");
    });
});

describe("the project the Dashboard's button names", () => {
    const projects = [{id: 1, name: "Farm", can_train: true}, {id: 2, name: "Roof", can_train: true}, {id: 3, name: "Roof", can_train: true}, {id: 4, name: "Shared", can_train: false}];

    it("is the only project the user may add a task to with that name", () => {
        expect(projectByName(projects, " Farm ").id).toBe(1);
    });

    it("is none when several have the name or the user may not add a task to it", () => {
        expect(projectByName(projects, "Roof")).toBeNull();
        expect(projectByName(projects, "Shared")).toBeNull();
        expect(projectByName(projects, "")).toBeNull();
    });
});

describe("a new task's upload", () => {
    it("creates the task, saves its training setting before any file, sends the files and commits", async () => {
        const { calls, send } = server();
        const progress = [];
        const upload = new Upload({projectId: 7, files: [file("a.jpg", 5), file("gcp.txt", 3)], send, wait: 0, onProgress: p => progress.push(p)});
        const task = await upload.start(info, {enabled: true, steps: 7000});
        expect(task.partial).toBe(false);
        expect(calls[0]).toMatchObject({method: "POST", url: TASKS});
        expect(calls[1]).toMatchObject({method: "POST", url: "/api/plugins/splatme/task/abc/auto"});
        expect(calls[1].body).toEqual({enabled: true, steps: 7000});
        expect(calls.filter(c => c.url === TASKS + "abc/upload/").map(c => c.name).sort()).toEqual(["a.jpg", "gcp.txt"]);
        expect(calls[calls.length - 1].url).toBe(TASKS + "abc/commit/");
        expect(progress[progress.length - 1]).toEqual({sent: 8, total: 8, files: 2, done: 2});
    });

    it("saves no setting for a task not trained by itself", async () => {
        const { calls, send } = server();
        await new Upload({projectId: 7, files: [file("a.jpg", 5)], send, wait: 0}).start(info, null);
        expect(calls.some(c => c.url.indexOf("/auto") >= 0)).toBe(false);
    });

    it("removes the task and sends nothing when its training setting is refused", async () => {
        const { calls, send } = server({"/api/plugins/splatme/task/abc/auto": {times: 1, status: 400, message: "Steps is too large."}});
        const upload = new Upload({projectId: 7, files: [file("a.jpg", 5)], send, wait: 0});
        await expect(upload.start(info, {enabled: true})).rejects.toThrow("Steps is too large.");
        expect(calls.map(c => c.url)).toEqual([TASKS, "/api/plugins/splatme/task/abc/auto", TASKS + "abc/remove/"]);
        expect(upload.task).toBeNull();
    });

    it("sends a large file in Dropzone's parts, in order, with the fields WebODM puts them together by", async () => {
        const { calls, send } = server();
        await new Upload({projectId: 7, files: [file("big.jpg", CHUNK * 2 + 1)], send, wait: 0}).start(info, null);
        const parts = calls.filter(c => c.name === "big.jpg");
        expect(parts.map(c => c.index)).toEqual(["0", "1", "2"]);
        expect(parts[2].body.get("dztotalchunkcount")).toBe("3");
        expect(parts[2].body.get("dzchunkbyteoffset")).toBe(String(CHUNK * 2));
        expect(parts[0].body.get("dzuuid")).toBe(parts[2].body.get("dzuuid"));
        expect(parts[2].body.get("images").size).toBe(1);
    });

    it("sends a large file again from its first part when a part's answer is lost, never that part alone", async () => {
        const { calls, send } = server({"big.jpg#1": {times: 1, status: 504}});
        const progress = [];
        await new Upload({projectId: 7, files: [file("big.jpg", CHUNK * 2 + 1)], send, wait: 0, onProgress: p => progress.push(p)}).start(info, null);
        expect(calls.filter(c => c.name === "big.jpg").map(c => c.index)).toEqual(["0", "1", "0", "1", "2"]);
        expect(progress[progress.length - 1].sent).toBe(CHUNK * 2 + 1);
    });

    it("does not commit while a file failed, and sends only that file again when retried", async () => {
        const { calls, send } = server({"b.jpg": {times: 1, status: 400, message: "Not an image"}});
        const upload = new Upload({projectId: 7, files: [file("a.jpg", 5), file("b.jpg", 5)], send, wait: 0});
        await expect(upload.start(info, null)).rejects.toThrow("b.jpg was not uploaded: Not an image");
        expect(calls.some(c => c.url.endsWith("/commit/"))).toBe(false);
        expect(upload.task.id).toBe("abc");
        const before = calls.length;
        await upload.retry();
        expect(calls.slice(before).map(c => c.name || c.url)).toEqual(["b.jpg", TASKS + "abc/commit/"]);
    });

    it("asks WebODM to remove the task when canceled, and does not commit", async () => {
        const { calls, send } = server();
        const upload = new Upload({projectId: 7, files: [file("a.jpg", 5)], send, wait: 0});
        const started = upload.start(info, null);
        upload.cancel();
        await expect(started).rejects.toThrow("Canceled.");
        expect(calls.some(c => c.url.endsWith("/commit/"))).toBe(false);
        expect(calls[calls.length - 1].url).toBe(TASKS + "abc/remove/");
    });
});

describe("the photos of a new task SplatMe trains", () => {
    const files = names => names.map(name => ({name}));
    it("are JPEG, or all TIFFs, with any text files beside them", () => {
        expect(photoProblem(files(["a.JPG", "b.jpeg", "gcp_list.txt", "geo.txt"]))).toBeNull();
        expect(photoProblem(files(["a_T.tif", "b_T.TIFF", "image_groups.txt"]))).toBeNull();
    });
    it("name a photo of another kind, or say that JPEG and TIFF are mixed", () => {
        expect(photoProblem(files(["a.jpg", "b.png"]))).toMatch(/b\.png is neither/);
        expect(photoProblem(files(["a.dng"]))).toMatch(/a\.dng/);
        expect(photoProblem(files(["a.jpg", "b.tif"]))).toMatch(/not both/);
    });
});
