# Contributing and releases

Use this repository as the canonical Iris source. Do not upload a Zotero profile, personal PDFs, chat history, audio recordings, access tokens, runtime caches, or machine-specific test output.

1. Edit `plugin/` source inputs. Do not edit generated `plugin/src/content/scripts/aidea.js`.
2. Run `npm run check`, `python plugin/test-speech-progress.py`, and `python scripts/package.py`.
3. Test the installer in an isolated Zotero profile. Check reopening the sidebar, settings → chat, external links, selection translation, and dictation state handling. Never test against a user's live library without permission.
4. Update `release.json` and the root package version together for a release. Use a new stable numeric version higher than the previous release.
5. Commit and push the reviewed changes to `main`. A main push runs CI but does not publish an addon update.
6. Create and push the matching tag, for example `git tag v3.4.8` then `git push origin v3.4.8`.

The tag workflow checks the version, builds and tests the addon, packages an XPI plus `updates.json` and `SHA256SUMS.txt`, and creates a GitHub Release. No personal API token is required in repository secrets: the release job uses GitHub's scoped workflow token. Wait for the workflow to succeed and verify all three release assets before announcing availability.

Never overwrite an existing released tag or installer. Fix a release by issuing a higher version. Do not publish older tags as the latest release. Keep the `aidea@visterainer` ID unless deliberately implementing a documented migration. Update compatibility bounds only after testing the corresponding Zotero versions.

Git synchronization is explicit: local edits are not automatically uploaded. After a requested change is verified, commit and push only the reviewed project files; publish a version tag when the user wants a release.
