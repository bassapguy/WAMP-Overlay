# WAMP Overlay

Windows desktop utility for managing WampServer local sites. It inventories configured Apache virtual hosts and can provision a new vhost with an empty starter site, WordPress, BookStack, or October CMS.

## Application

See [`october-wamp-installer/README.md`](october-wamp-installer/README.md) for Windows requirements, setup, platform notes, and operator instructions.

## Windows releases

Push a version tag matching `october-wamp-installer/package.json` (for example, `v1.0.1`) to trigger the GitHub Actions workflow. It runs tests and the production build, creates or reuses the matching GitHub Release, and publishes the Windows NSIS installer and updater metadata.

To retry a partial release without moving the tag, open **Actions → Windows release → Run workflow**, set **Use workflow from** to `main`, and enter the existing version tag (for example, `v1.0.1`) in `release_tag`. Same-tag runs are serialized, and already-uploaded assets are replaced by the publisher when needed.

The app, WampServer sites, databases, and Apache configuration remain local to each computer. The initial installer is unsigned; see the app guide for the SmartScreen note.
