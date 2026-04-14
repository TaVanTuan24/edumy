# AI Slide System

## Old architecture problems

The previous slide pipeline asked the model to produce presentation structure and geometry at the same time. That created several problems:

- The model emitted raw `x` and `y` values without a stable layout grid.
- Titles, bullets, and body text could be placed on top of each other.
- Density was uncontrolled, so long paragraphs frequently overflowed.
- Prompt, parsing, normalization, and layout logic lived together in `routes/ai.js`, which made the behavior hard to reason about and extend.

## New architecture

The slide generator now follows a semantic pipeline:

1. `routes/ai.js` builds a strict Llama prompt with allowed templates only.
2. Llama returns semantic JSON such as `title`, `subtitle`, `bullets`, `leftColumn`, and `rightColumn`.
3. `utils/aiSlidePipeline.js` normalizes content, enforces density limits, and can split oversized slides.
4. A template resolver maps semantic content into safe slide regions and produces backward-compatible `elements` with `x`, `y`, `width`, and `height`.
5. Validation checks element bounds and bounding-box overlap before the slides reach the editor/runtime.

## Template resolution

Each slide picks exactly one template from the built-in set:

- `title-center`
- `title-content`
- `bullet-list`
- `two-column`
- `section-divider`
- `title-left-content-right`
- `summary-slide`

Each template has fixed safe zones for title, subtitle, body, columns, and callouts. The resolver applies:

- consistent slide padding and column gaps
- role-based typography defaults
- text fitting based on estimated text measurement
- bullet stacking with controlled spacing
- shared theme presets for title/body/accent colors

## Overlap prevention

Overlap prevention happens in three places:

- Density rules limit bullet count, words per bullet, and total words per slide.
- Text fitting reduces font size inside role-specific limits and trims text if required.
- Validation checks whether any element exceeds canvas bounds or overlaps another resolved element.

If the incoming content is too dense, the pipeline reformats or splits it into additional slides before rendering.
