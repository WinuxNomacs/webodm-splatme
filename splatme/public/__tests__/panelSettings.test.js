import { createPanelSettings, isCreation, isEdit } from '../panelSettings';

// jQuery, as far as the module uses it: $(document).on(event, handler)
function fakeJQuery(){
    const handlers = {};
    const $ = () => ({on: (name, handler) => { handlers[name] = handler; }});
    $.send = (settings) => handlers.ajaxSend({}, {}, settings);
    $.complete = (settings, status, json) => handlers.ajaxComplete({}, {status, responseJSON: json}, settings);
    return $;
}

const CREATE = {type: "POST", url: "/api/projects/3/tasks/"};
const SETTING = {enabled: true, options: {steps: 7000}};

describe("a New Task panel's choice", () => {
    let $, applied, settings;

    beforeEach(() => {
        jest.useFakeTimers();
        $ = fakeJQuery();
        applied = [];
        settings = createPanelSettings($, isCreation, (taskId, setting) => applied.push([taskId, setting]), 1000);
    });

    afterEach(() => jest.useRealTimers());

    test("is kept with the panel it was chosen in", () => {
        const panel = {isConnected: true}, other = {isConnected: true};
        settings.set(panel, SETTING);
        expect(settings.get(panel)).toBe(SETTING);
        expect(settings.get(other)).toBeNull();
    });

    test("goes to the task WebODM creates when the panel is saved", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        $.send(CREATE);
        panel.isConnected = false;
        jest.advanceTimersByTime(5000);     // the answer is slow: the setting still waits
        $.complete(CREATE, 201, {id: "abc"});
        expect(applied).toEqual([["abc", SETTING]]);
        expect(settings.get(panel)).toBeNull();
    });

    test("is forgotten when the panel is canceled", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        panel.isConnected = false;
        jest.advanceTimersByTime(1000);
        $.send(CREATE);
        $.complete(CREATE, 201, {id: "abc"});
        expect(applied).toEqual([]);
    });

    test("is forgotten when the task could not be created", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        $.send(CREATE);
        panel.isConnected = false;
        $.complete(CREATE, 500, null);
        $.send(CREATE);
        $.complete(CREATE, 201, {id: "abc"});
        expect(applied).toEqual([]);
    });

    test("does not go to a task created from another panel while its own is open", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        $.send(CREATE);
        $.complete(CREATE, 201, {id: "other"});
        expect(applied).toEqual([]);
        expect(settings.get(panel)).toBe(SETTING);
    });

    test("ignores WebODM's other requests", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        panel.isConnected = false;
        const upload = {type: "POST", url: "/api/projects/3/tasks/abc/upload/"};
        $.send(upload);
        $.complete(upload, 200, {id: "abc"});
        const list = {type: "GET", url: "/api/projects/3/tasks/"};
        $.send(list);
        $.complete(list, 200, {id: "abc"});
        expect(applied).toEqual([]);
    });

    test("is nothing again when set to nothing", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        settings.set(panel, null);
        expect(settings.get(panel)).toBeNull();
    });
});

describe("an Edit Task panel's choice", () => {
    const EDIT = {type: "PATCH", url: "/api/projects/3/tasks/abc/"};
    let $, applied, settings;

    beforeEach(() => {
        jest.useFakeTimers();
        $ = fakeJQuery();
        applied = [];
        settings = createPanelSettings($, isEdit, (taskId, setting) => applied.push([taskId, setting]), 1000);
    });

    afterEach(() => jest.useRealTimers());

    test("goes to its task when WebODM has saved the panel", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING, "abc");
        $.send(EDIT);
        panel.isConnected = false;  // WebODM closes the panel once the task is saved
        $.complete(EDIT, 200, {id: "abc"});
        expect(applied).toEqual([["abc", SETTING]]);
    });

    test("stays while the save fails and the panel stays open", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING, "abc");
        $.send(EDIT);
        $.complete(EDIT, 500, null);
        expect(applied).toEqual([]);
        expect(settings.get(panel)).toBe(SETTING);
    });

    test("does not go to another task saved while its panel was canceled", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING, "abc");
        const other = {type: "PATCH", url: "/api/projects/3/tasks/xyz/"};
        $.send(other);
        panel.isConnected = false;
        $.complete(other, 200, {id: "xyz"});
        expect(applied).toEqual([]);
    });

    test("ignores the creation of a task", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING, "abc");
        panel.isConnected = false;
        $.send(CREATE);
        $.complete(CREATE, 201, {id: "abc"});
        expect(applied).toEqual([]);
    });
});
