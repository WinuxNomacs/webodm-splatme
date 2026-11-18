import {downloadUrl, readLog, request, webodm} from "../api";

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
