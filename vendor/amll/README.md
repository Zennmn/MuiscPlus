# Vendored AMLL source

Source: https://github.com/amll-dev/applemusic-like-lyrics

Local runtime snapshot: `f32285864056587c4afa59d310208b0aa829cb53`,
updated on 2026-11-06 from the `86200dead453bb067e554e989110cbadca8d4756`
snapshot of the user's local `applemusic-like-lyrics` checkout.
The extension retains the existing English line-break rule (`#629` is omitted).
It also keeps the pre-`#632` glow rule: an eligible timed syllable can
trigger glow on the full word even when the merged text exceeds seven characters.

The local source also includes the one-line cover pause-shrink fix from upstream
PR #640 (`1df0703bfc86017f115d439bf2a65c702c1a8d18`): paused static covers
shrink in non-immersive layouts, while immersive covers retain their size.

PR #637 (`8a53ae3e02f0791745b4191038a4e41c6a49f7b0`) is backported to core
and React for render-only CJK/Latin/digit spacing. The extension's prebuilt
lyric player explicitly enables it; core and React keep the upstream opt-in
default. Translation, romanization and ruby annotations remain unchanged.
PR #639 (`c53ffe15c9785ebf68e45e65375ef19227e7a4c4`) improves balanced line
breaks for mixed CJK/Latin lyrics. Pure-English punctuation rules and the
local pre-#632 glow rule are retained.
The dynamic line balancer reads the main lyric text stored on each word group,
so ruby and inline romanization do not affect mixed-script break decisions.

Only the `src` directories and package metadata of core (0.6.0), react (0.6.0),
and react-full (0.5.0) are included, together with the TTML package (1.0.1),
its upstream fixtures, and its monorepo TypeScript base configuration.
See LICENSE for AGPL-3.0-only terms.
The source is compiled by the root Vite configuration; the adjacent checkout
is not required to install or build this extension.

TTMLParser and toAmllLyrics are compiled without source modifications to
src/vendor/amll-ttml/parser.js by scripts/build-ttml.mjs. The background DOM
adapter adds missing paragraph keys and resolves prefixed element lookups;
the normalized data retains every main/background line's AMLL roles, timing,
translation, romanization and word annotations through extension enrichment.

Local patch: PrebuiltLyricPlayer accepts a lyrics-only time correction,
labels its media buttons, respects shuffle/repeat capability atoms, and accepts
callbacks for its original playlist/AirPlay buttons. The horizontal bottom
controls and both vertical control states accept a fullscreen-button slot using
the original ToggleIconButton styling and spacing. The extension toggles
browser window fullscreen through the background windows API and restores its
previous state.
The upstream cover, media info, collapse control and controlled playlist APIs
are available alongside the extension's existing callbacks and slots. The new
cover frame ref leaves the extension's current lyric alignment unchanged.
Titanium and its options are available to library consumers; the extension's
background selection and default renderer remain unchanged.
The horizontal layout's
controls below the cover occupy 25% of the player container height, including
their top spacing. The square cover is enlarged to 60% of the container height
(55% or 50% in shorter windows), capped at 38% of the container width;
the controls match its width. The media-button row flexes within the fixed-height
controls, and shorter containers use less slider spacing to keep song details visible.
The horizontal lyric container spans the full player height and fades over 5%
at each edge, so the bottom control rows do not add an extra blank lyric area.
Other layout rules, icons, and component CSS retain the
upstream snapshot's appearance.

The lyric component subscribes directly to the Jotai playback clock to feed the
AMLL core without a React render for each media frame. Line event callbacks are
stable, and memoized time labels subscribe to their formatted text. The core's
animation loop and spring/word-mask implementation are unchanged.

Local brightness-layer fix: suppress opacity transitions across two animation
frames when switching between a single resting layer and the bright/dim pair.
A single rAF can run before the first style commit after a message or mount,
causing an unsung line to briefly brighten as the new dim copy overlaps the
still-visible main layer. Both pending frames are canceled on disposal or a
superseding switch. Singing transitions and word/glow animations are unchanged.

