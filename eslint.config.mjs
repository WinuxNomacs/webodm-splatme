// ESLint for the plugin's front end: `npm run lint -- splatme` at the repo root, or the VSCode ESLint extension
import js from "@eslint/js";
import globals from "globals";

export default [
    {ignores: ["**/node_modules/", "**/build/", "**/dist/", "ignored/", "splatme/public/webpack.config.js", "splatme/public/vendor/"]},
    {
        // Loaded on every page by a <script> tag: plain ES5, with WebODM's React and PluginsAPI
        files: ["splatme/public/main.js"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 5,
            sourceType: "script",
            globals: {...globals.browser, PluginsAPI: "readonly", React: "readonly"},
        },
    },
    {
        // The components and their modules: built by WebODM's webpack and Babel (ES modules, JSX, class fields)
        files: ["splatme/public/**/*.{js,jsx}"],
        ignores: ["splatme/public/main.js", "splatme/public/__tests__/**"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {ecmaFeatures: {jsx: true}},
            globals: {...globals.browser},
        },
    },
    {
        // Jest's tests, ES modules through babel-jest (Babel's settings are in package.json)
        files: ["splatme/public/__tests__/**/*.js"],
        ...js.configs.recommended,
        languageOptions: {ecmaVersion: 2022, sourceType: "module", globals: {...globals.browser, ...globals.node, ...globals.jest}},
    },
    {
        files: ["dev/**/*.js"],
        ...js.configs.recommended,
        languageOptions: {ecmaVersion: 2022, sourceType: "commonjs", globals: {...globals.browser, ...globals.node}},
    },
];
