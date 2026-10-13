# Privacy: what BrewCV does with your data, and how to check it yourself

BrewCV never uploads your data. You shouldn't have to take that on trust, so this page says where your data lives, how to watch the network yourself in a few minutes, and what the browser enforces on top of that.

## Where your data stays

- **In your browser.** Your record and your saved resumes are kept in this browser's own storage, on this device, and saved on every change.
- **In the files you save.** *Back up*, *Save to file* and the exports write a file to your disk. If you link a folder (Chrome, Edge), BrewCV mirrors your record there. Those files are yours, and BrewCV doesn't look at them again unless you open them.
- **Not on a server.** There is no account, no sign-in and no BrewCV server to send anything to. The app is a folder of static files.

Loading the app is a request like any other web page. Whoever hosts it can see that you opened it, and your address, as with any site. The files it sends are the app itself (code, fonts, the example). Your resume isn't in them, and nothing goes back.

## Check it yourself

Use the network panel in your browser's developer tools. It lists every request a page makes.

**Chrome, Brave, Edge**

1. Open BrewCV. Press **F12**, or **Cmd+Option+I** on a Mac, and choose the **Network** tab.
2. Reload the page, so the list starts from the beginning.
3. Use the app: open the example, edit a line, run Fit, export, open Design, import a file.
4. Filter by **Fetch/XHR**. These are the requests a page makes by itself, and the only way a page could send your data out.

**Firefox**

1. Open BrewCV. Press **F12**, or **Cmd+Option+I** on a Mac, and choose **Network**.
2. Reload, use the app as above, then pick the **XHR** filter (Firefox groups fetch requests under it).

**Safari**

1. Turn on the Develop menu first. In **Safari › Settings › Advanced**, tick *Show features for web developers* (older versions: *Show Develop menu in menu bar*).
2. Open BrewCV, then **Develop › Show Web Inspector** (Cmd+Option+I) and choose **Network**.
3. Reload, use the app, and pick the **XHR** filter.

**What you should see.** Every request goes to the app's own address, the same one in your address bar. Look at the *Domain* or *Name* column: it's your own copy's address and nothing else. The requests that do show up are BrewCV reading its own files, such as the example data, a template or a theme. Nothing carries your resume.

**The stronger test.** Load the app once. Then turn Wi-Fi off, or tick *Offline* in the Network tab, and keep working. Edit, switch resumes, export. It all still works, because it never needed a connection. Something that was sending your data out wouldn't survive that.

A few links in the app (the JSON Resume site, the source code) open another web page when you click them. That's you leaving the app, not the app sending anything. They open in a new tab.

## The guard in the page

The first lines of `index.html` hold a Content-Security-Policy, a rule your browser enforces for this page. It says the page may only talk to its own address, so a request to anywhere else is refused, whatever the code tries.

To see it: right-click the page and choose *View Page Source*. The line starts with `<meta http-equiv="Content-Security-Policy"`, near the top. The same policy sits in `templates/*.html`, which draw the resume.

The policy is a seat belt on top of the claim, not the claim itself. The claim holds because the code never sends your data anywhere, and `checks/csp-check.mjs` and the network panel are how you'd catch a change.

## The desktop build

The experimental macOS app (see [DEVELOPMENT.md](DEVELOPMENT.md#desktop-build-macos-preview)) runs the same page from files inside the app, not from a website. Its policy is the page's policy with one addition: `connect-src` also lists `ipc:` and `http://ipc.localhost`, which Tauri uses to talk to the app's own native side on this computer (the Save dialog and writing the PDF). The web page's policy is unchanged, and `checks/desktop-check.mjs` fails if the desktop copy's rule leaks into it. The app has no update check yet, so it makes no network requests of its own; when one is added, it will be listed here. The app can read and write only the folder you pick with Link a folder (and what is inside it), and remembers its location on this computer. The experimental Linux Flatpak is built without the network permission, so the sandbox itself blocks any connection, and without a broad file permission.

## What it can't promise

- **Browser extensions.** An extension can read any page you open, BrewCV included, and the policy doesn't bind it. Look at what you've installed.
- **A copy hosted somewhere else.** The policy belongs to the page you got it from. Someone who changes BrewCV and hosts it elsewhere is running a different program, with their own policy or none. Check the address in your bar. BrewCV is under the AGPL, so anyone who runs a changed copy as a service has to offer you its source, and you can read what it does. The menu links to the source for this reason.
- **Your device.** Browser storage and saved files are as private as the computer they're on. If someone else uses your account, they can open them. Back up to a place you trust, and clear the browser's data on a shared computer.
