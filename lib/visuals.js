/*
NEYO Visual Intelligence: the rule that teaches the model to
draw. The browser lays out and draws ```neyo-visual blocks
(public/js/components/visual-core.js + visuals.js). Broken data
is dropped there, so the written answer must stand on its own.
*/

export const VISUAL_RULE = `VISUALS (diagrams inside answers):
When a picture explains better than words, add ONE \`\`\`neyo-visual block (JSON) where it helps, usually after the first short paragraph. Good for: how something works or flows, steps/process, cycles, history/timelines, hierarchies and parts of a topic, levels, funnels, overlaps/differences between 2-3 things, system layers, key numbers. NOT for small talk, one-line facts, code, or when the user asks for plain text. Numbers/charts with data → Smart UI chart instead; tools to use → Smart UI/mini app.
Choose the type that matches the idea:
- flow: {"type":"flow","title":"...","direction":"down|right","items":[{"id":"a","label":"Start","sub":"short detail"},{"id":"b","label":"Ready?","shape":"diamond"}],"edges":[["a","b"],["b","c","Yes"]]}  (shape box|pill|diamond|circle; edge label optional; {"from","to","label","dashed":true} also ok)
- steps: {"type":"steps","items":[{"label":"Boil water","sub":"1 cup"}]}
- timeline: {"type":"timeline","items":[{"date":"1947","label":"Independence","sub":"..."}]}
- cycle: {"type":"cycle","center":"Water","items":[{"label":"Evaporation","sub":"..."}]}  (3-8 items)
- tree (hierarchy, root on the left) / mindmap (topic in the middle): {"type":"mindmap","root":{"label":"Topic","children":[{"label":"Branch","children":["Leaf","Leaf"]}]}}  (max 4 levels, ~5 branches)
- pyramid (top = smallest/highest level) / funnel (top = widest): {"type":"pyramid","items":[{"label":"...","sub":"...","value":"optional"}]}
- venn: {"type":"venn","items":[{"label":"Cats","items":["Independent"]},{"label":"Dogs","items":["Loyal"]}],"both":["Pets"]}  (2-3 sets; 3 sets may add "all")
- layers: {"type":"layers","items":[{"label":"Interface","sub":"what it does"}]}  (top layer first)
- stats: {"type":"stats","items":[{"value":"241M","label":"Population","sub":"2023"}]}  (2-6 key numbers)
Every item may add "note" (1-2 sentences shown when the user presses Play, so walk them through it), "tip" (hover text) and "tone" (accent|good|bad|warn|muted). Optional "caption" (one line under the visual) and "animate": true (moving arrows for flows/cycles).
Rules: labels 1-4 words, "sub" under 8 words; 3-12 items; order items in the order to explain them; real facts only (same truth rules as the text); write the JSON valid, no comments. Use the user's language for labels. Never say "neyo-visual", "JSON" or "diagram code" in the answer; at most say "visual" or nothing.`;

export const VISUAL_DRAW_RULE = `FREE DRAWINGS: when the idea is a picture rather than boxes and arrows (anatomy, solar system, a machine, a map-like layout, geometry, a scene), the \`\`\`neyo-visual block may instead hold one <svg viewBox="0 0 W H"> (W about 640, no width/height). Allowed: g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient marker animate animateTransform. Not allowed (removed): script, style, foreignObject, image, links, event attributes, outside URLs. Colours follow NEYO light/dark only through classes: fills f-accent f-good f-bad f-warn f-muted f-soft f-strong f-bg f-c1..f-c5, strokes s-accent s-muted s-line s-strong s-c1..s-c5, text t-accent t-muted (plain <text> is already the right colour; class "label" bold, "sub" small muted). Real colours like #f5b400 are ok when the colour matters (sun, blood, leaf). Motion classes: flow (moving dashes), pulse, spin, float, draw (needs pathLength="1"). Add data-step="0,1,2..." plus data-label and data-note on parts to enable Play, and data-tip for hover help. Clean, minimal, flat, generous spacing, rounded shapes, labels never overlapping shapes or each other.`;

const VISUAL_WORDS = /\b(how (does|do|is|are)|kaise|kese|kaisay|kya hota|explain|samjha\w*|sam[jh]h?ao|batao.*(process|tareeqa)|process|steps?|cycle|chakkar|timeline|history|tareekh|structure|architecture|hierarchy|types? of|kinds? of|parts? of|anatomy|diagram|flow ?chart|mind ?map|visual|draw|tasveer|picture|map out|compare|difference|farq|vs\.?|versus|funnel|pyramid|layers?|system|workflow|lifecycle|life cycle|overview)\b/i;

/* the extra drawing rules only when a picture is likely useful */
export function wantsVisual(text = "") {
    const t = String(text || "").slice(0, 1500);
    return t.trim().length > 6 && VISUAL_WORDS.test(t);
}
