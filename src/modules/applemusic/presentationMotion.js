// One page timeline for the sheet, its handoff to the native bar.
(() => {
    const duration = 500;
    const easing = 'cubic-bezier(.32,.72,.35,1)';
    const handoff = .04;
    const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
    const translate = y => 'translate3d(0px, ' + y + 'px, 0)';

    function poses(compact, expanded, opening, rest = compact) {
        return opening
            ? [rest, { ...compact, offset: handoff, easing }, expanded]
            : [{ ...expanded, easing }, { ...compact, offset: 1 - handoff }, rest];
    }

    function bezier(x1, y1, x2, y2, x) {
        if (x <= 0 || x >= 1) return x;
        const at = (t, a, b) => 3 * (1 - t) * t * ((1 - t) * a + t * b) + t ** 3;
        let low = 0, high = 1;
        for (let i = 0; i < 16; i++) {
            const t = (low + high) / 2;
            if (at(t, x1, x2) < x) low = t;
            else high = t;
        }
        return at((low + high) / 2, y1, y2);
    }

    function closeSheetOpacity(origin, distance, viewportHeight) {
        // Let the color clear before the sheet's top reaches the native bar.
        // Convert the fade's travel distances back to offsets on the existing close curve.
        const end = clamp(origin.top - Math.max(8, origin.height * .25), 0, distance);
        const start = Math.max(0, end - Math.max(origin.height * 2, viewportHeight * .14));
        const offset = y => (1 - handoff) * bezier(.72, .32, 1, .35, y / distance);
        return [
            { opacity: 1 },
            { opacity: 1, offset: end > 0 ? offset(start) : .6, easing: 'ease-in-out' },
            { opacity: 0, offset: end > 0 ? offset(end) : .9 },
            { opacity: 0 },
        ];
    }

    function svgElement(tag, attributes) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
        return node;
    }

    function create({ stage, plane, frame, scrim, background, origin, cover, expanded }) {
        if (!frame?.animate) return null;
        const opening = !expanded;
        const animations = [];
        const add = (node, keyframes) => {
            const track = node.animate(keyframes, { duration, fill: 'both' });
            animations.push(track);
            track.pause();
            track.currentTime = 0;
            track.finished.catch(() => {});
        };
        let maskLayer;
        const dispose = () => {
            for (const track of animations) track.cancel();
            if (maskLayer) {
                plane.style.removeProperty('mask-image');
                maskLayer.remove();
            }
        };
        const hit = (rect, x, y, offset = 0) => rect?.width > 0 && rect.height > 0
            && x >= rect.left && x <= rect.left + rect.width
            && y >= rect.top + offset && y <= rect.top + offset + rect.height;

        try {
            // The panel is already full-sized. Start just below the floating
            // bar so the web layout doesn't introduce a full-width band above it.
            const height = stage.clientHeight;
            const y = origin ? clamp(origin.top + origin.height, 0, height) : height;
            const parked = { transform: translate(y) }, full = { transform: translate(0) };
            if (opening) {
                add(frame, poses({ ...parked, opacity: 1 }, { ...full, opacity: 1 }, true, { ...parked, opacity: 0 }));
            } else {
                add(frame, poses(parked, full, false));
                if (origin) add(frame, closeSheetOpacity(origin, y, height));
            }
            add(scrim, poses({ opacity: 0 }, { opacity: 1 }, opening));
            if (background) {
                const transformOrigin = '50% 0%';
                add(background, poses({ transformOrigin, transform: 'scale(1)' },
                    { transformOrigin, transform: 'scale(.965)' }, opening));
            }

            // Let the actual Apple bar show through while the sheet rises behind
            // it. The rounded opening never moves and doesn't touch Apple's DOM.
            if (origin?.capsule && globalThis.CSS?.supports('mask-image', 'url(#lyplus-amll-bar-mask)')) {
                const id = 'lyplus-amll-bar-mask';
                const width = stage.clientWidth, height = stage.clientHeight;
                const svg = svgElement('svg', { width: 0, height: 0, 'aria-hidden': true, focusable: false });
                svg.classList.add('lyplus-amll-bar-mask');
                const mask = svgElement('mask', { id, x: 0, y: 0, width, height,
                    maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse', 'mask-type': 'luminance' });
                const radius = clamp(origin.radius || 0, 0, Math.min(origin.width, origin.height) / 2);
                const hole = svgElement('rect', { x: origin.left, y: origin.top, width: origin.width, height: origin.height,
                    rx: radius, ry: radius, fill: 'black' });
                mask.append(svgElement('rect', { width, height, fill: 'white' }), hole);
                svg.append(mask);
                maskLayer = svg;
                stage.append(svg);
                plane.style.maskImage = 'url(#' + id + ')';
                add(hole, opening
                    ? [{ opacity: 1 }, { opacity: 1, offset: handoff, easing }, { opacity: 0, offset: .35 }, { opacity: 0 }]
                    : [{ opacity: 0 }, { opacity: 0, offset: .65, easing }, { opacity: 1, offset: 1 - handoff }, { opacity: 1 }]);
            }

            return { animations, dispose, hitsCover: (x, y) => hit(origin?.cover, x, y)
                || hit(cover, x, y, frame.getBoundingClientRect().top) };
        } catch (_) {
            dispose();
            return null;
        }
    }

    globalThis.LyPlusAMLLPresentation = { create };
})();
