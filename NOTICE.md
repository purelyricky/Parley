# Third-party notices

## Strobi mascot: AGPL-3.0-only

The app mascot ("Strobi") and its animation engine come from
[smontlouis/bible-strong-avatar-lab](https://github.com/smontlouis/bible-strong-avatar-lab):

- `@bible-strong/avatar-core` (npm), licensed **AGPL-3.0-only**
- `app/assets/strobi.avatar.json`, the Strobi definition from that repository

The AGPL is a strong copyleft licence. If you distribute the Parley app (App Store, Play Store, APK
to others) or let people use a modified version over a network, you must offer them the complete
corresponding source code of the app under the AGPL. For private testing on your own phone this has
no practical effect.

To ship under a different licence, replace the mascot: it lives entirely in `app/src/ui/Mascot.tsx`
and `app/assets/strobi.avatar.json`. Remove `@bible-strong/avatar-core`, delete the `ajv` alias in
`app/metro.config.js` and `app/src/shims/ajv-stub.js`, and render your own character in `Mascot.tsx`
(keep the `mood` prop so the screens don't change).
