# WAMP Overlay

Windows desktop utility for managing WampServer local sites. It inventories configured Apache virtual hosts and can provision a new vhost with an empty starter site, WordPress, BookStack, or October CMS.

## Application

See [`october-wamp-installer/README.md`](october-wamp-installer/README.md) for Windows requirements, setup, platform notes, and operator instructions.

## Windows releases

Push a version tag matching `october-wamp-installer/package.json` (for example, `v1.0.0`) to trigger the GitHub Actions workflow. It runs tests, builds the app, and publishes the Windows NSIS installer and updater metadata to GitHub Releases.

The app, WampServer sites, databases, and Apache configuration remain local to each computer. The initial installer is unsigned; see the app guide for the SmartScreen note.
