import { createPanelSettings, isCreation } from '../panelSettings';

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

describe("a panel saved in a way SplatMe does not hear", () => {
    let $, applied, missed, settings;

    beforeEach(() => {
        jest.useFakeTimers();
        $ = fakeJQuery();
        applied = [];
        missed = [];
        settings = createPanelSettings($, isCreation, (taskId, setting) => applied.push([taskId, setting]), 1000, setting => missed.push(setting));
    });

    afterEach(() => jest.useRealTimers());

    test("is said when the panel closes after its save button and no request comes", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        settings.pressed(panel, true);
        panel.isConnected = false;
        jest.advanceTimersByTime(1000);
        expect(missed).toEqual([SETTING]);
        expect(applied).toEqual([]);
    });

    test("is not said for a panel canceled after its save button", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        settings.pressed(panel, true);   // Review
        settings.pressed(panel, false);  // then Cancel
        panel.isConnected = false;
        jest.advanceTimersByTime(1000);
        expect(missed).toEqual([]);
    });

    test("is not said when the request is heard", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        settings.pressed(panel, true);
        $.send(CREATE);
        panel.isConnected = false;
        jest.advanceTimersByTime(3000);
        $.complete(CREATE, 201, {id: "abc"});
        jest.advanceTimersByTime(1000);
        expect(missed).toEqual([]);
        expect(applied).toEqual([["abc", SETTING]]);
    });

    test("keeps the press when the choice changes after it", () => {
        const panel = {isConnected: true};
        settings.set(panel, SETTING);
        settings.pressed(panel, true);
        const changed = {enabled: true, options: {steps: 2000}};
        settings.set(panel, changed);
        panel.isConnected = false;
        jest.advanceTimersByTime(1000);
        expect(missed).toEqual([changed]);
    });
});
