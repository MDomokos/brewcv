# Contributing to BrewCV

Thanks for looking. Fixes, new checks, translation corrections and themes are all welcome. This page is the short version. The layout of the code, every check and the deploy guards are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## What kind of change

- **A translation correction.** The quickest way in, and you don't need to read any code. See *Translations need native speakers* in the [README](README.md#translations-need-native-speakers).
- **A theme.** [docs/THEMES.md](docs/THEMES.md) has four routes, and the first needs only a text editor.
- **A fix or a feature.** Open an issue first for anything bigger than a fix, so we can agree what it should do before you write it. One rule decides most questions: BrewCV picks from wordings the user wrote and never writes or rewrites their text.
- **Anything that touches privacy.** Read [docs/PRIVACY.md](docs/PRIVACY.md). The app must not make a request to any address but its own. A change that needs one won't be merged.

## Running it

There's nothing to build. Serve the folder and open it:

```
python3 -m http.server 8000     # then open http://localhost:8000/
```

Browsers won't run ES modules from `file://`, so the page needs a server.

## The rules the code follows

- **No build step, no bundler, no framework, no runtime dependency.** What's in the repo is what the browser runs. `playwright` is allowed in `checks/` only, for development.
- **Every path is relative.** The deployed site lives under a subpath.
- **Every string the user sees goes through `t()`** and into all ten catalogues in `src/i18n/`. Write the English, add the other nine, and leave them marked `review: 'machine'`. Put your keys in one block with your own prefix at the end of each file.
- **Nothing real goes in the repo.** No real names, phone numbers, emails, employers or dates. Tests and examples use `data/example.json`, which is fictional.
- **Images** go in clean, with no embedded metadata.
- **Don't bump the version** in `package.json` or `sw.js`. Add a line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice, describing the result and not the steps.

## Checks

These need only Node. Run them before you open a pull request:

```
node checks/model-check.mjs && node checks/store-check.mjs && node checks/paginate-check.mjs \
&& node checks/shell-check.mjs && node checks/edit-check.mjs && node checks/resumes-check.mjs \
&& node checks/focus-check.mjs && node checks/lang-check.mjs && node checks/diff-check.mjs \
&& node checks/import-check.mjs && node checks/export-check.mjs && node checks/tokens-check.mjs \
&& node checks/career-check.mjs && node checks/i18n-check.mjs && node scripts/tokens.mjs --check \
&& node checks/recipe-check.mjs && node checks/parts-check.mjs && node checks/measurement-check.mjs \
&& node checks/csp-check.mjs && node checks/preload-check.mjs && node checks/i18n-review-check.mjs && node checks/version-check.mjs \
&& node checks/validate-data.mjs data/example.json
```

If you changed anything under `src/ui/`, also run the browser test, `node checks/smoke-shell.mjs`. It needs Playwright and a Chromium (set `CHROME_PATH` to use one you have installed). If you added a check, make sure it fails without your change and passes with it.

Before a change goes out, the deploy runs `node checks/preflight-deploy.mjs` on the assembled site. It refuses real contact details, images with embedded metadata, and root-absolute paths.

## Where things are

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the code layout, each check, the command-line scripts, deploying, versioning and the prior art that was read. [docs/THEMES.md](docs/THEMES.md) is for theme makers, and [docs/PRIVACY.md](docs/PRIVACY.md) is how to check what the app sends.

By contributing you agree your change is under the [AGPL-3.0-or-later](LICENSE), like the rest of BrewCV.
