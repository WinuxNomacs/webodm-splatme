import {downloadUrl, readLog, request, thumbnailUrl, webodm} from "../api";

const NO_ANSWER = "WebODM did not answer. Check the connection, then try again.";

describe("a request that gets no answer (the network is off)", () => {
    beforeEach(() => { global.fetch = jest.fn(() => Promise.reject(new TypeError("Failed to fetch"))); });
    afterEach(() => { delete global.fetch; });

    test("says so in words, not the browser's", async () => {
        await expect(request("GET", "tasks")).rejects.toThrow(NO_ANSWER);
        await expect(request("POST", "task/1/train", {})).rejects.toThrow(NO_ANSWER);
        await expect(readLog("1", 0)).rejects.toThrow(NO_ANSWER);
        await expect(webodm("GET", "/api/projects/")).rejects.toThrow(NO_ANSWER);
    });

    test("has no status, unlike a refusal", async () => {
        const error = await request("GET", "tasks").catch(e => e);
        expect(error.status).toBeUndefined();
    });
});

describe("the edited model's download", () => {
    test("is the task's download under SplatMe's API", () => {
        expect(downloadUrl("b3a01458-ca71")).toBe("/api/plugins/splatme/task/b3a01458-ca71/download");
    });
});

describe("a thumbnail", () => {
    afterEach(() => { delete global.fetch; });

    test("is sent as it is, with its type and the CSRF token", async () => {
        document.cookie = "csrftoken=abc";
        global.fetch = jest.fn(() => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({thumbnail: 5})}));
        const picture = new Blob(["jpeg"], {type: "image/jpeg"});
        await expect(request("PUT", "task/1/thumbnail", picture)).resolves.toEqual({thumbnail: 5});
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe("/api/plugins/splatme/task/1/thumbnail");
        expect(init.body).toBe(picture);
        expect(init.headers).toEqual({"X-CSRFToken": "abc", "Content-Type": "image/jpeg"});
    });

    test("is read at an address that changes with it", () => {
        expect(thumbnailUrl("b3a0", 1763800000)).toBe("/api/plugins/splatme/task/b3a0/thumbnail?v=1763800000");
    });
});
