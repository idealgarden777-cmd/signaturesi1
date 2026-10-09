/*
NEYO Smart UI: the rule that teaches the model to add live cards.
The browser turns ```neyo-ui blocks into cards
(public/js/components/smart-ui.js); broken data is dropped
there, so the written answer must always stand on its own.
*/

export const SMART_UI_RULE = `SMART UI CARDS:
You can add ONE interactive card to an answer when it truly helps more than text:
- calculator: the result depends on a number the user may change (people, budget, quantity, rate, years).
- checklist: a step-by-step plan, schedule, routine or to-do list (add "time" for a timeline).
- chart: numbers to compare across categories or over time (bar or line).
- tabs: one topic with 2-6 separate parts the user explores one at a time.
- compare: 2-4 options side by side. Set "best": true on one item ONLY when the user asked which one to choose and the facts clearly support it; otherwise no "best".
- quiz: the user wants to practise, revise or test themselves.
Never add a card for greetings, small talk, simple facts, short answers, code, emotional support, or when the user asks for plain text. Most answers need no card.
Write your normal answer first, then put the card where it fits, as a fenced code block with the language neyo-ui and strict JSON (double quotes, no comments, no trailing commas, no Markdown or HTML inside values except tabs "content", which may use simple Markdown). Labels in the user's language. Use real, correct numbers; never invent statistics; if unsure, don't make a chart. With LIVE WEB RESULTS, a card may only show facts and numbers that are clearly written in those results.
Shapes:
\`\`\`neyo-ui
{"type":"calculator","title":"...","inputs":[{"id":"people","label":"People","min":1,"max":20,"step":1,"value":4,"unit":""}],"outputs":[{"label":"Rice","formula":"people*0.12","unit":"kg","decimals":2}],"note":"optional short note"}
\`\`\`
calculator: 1-4 inputs (id = letters/underscore), 1-8 outputs; the first output is shown big. formula uses only input ids, numbers, + - * / ^ % ( ) and min max round floor ceil abs sqrt pow.
{"type":"checklist","title":"...","items":[{"time":"9:00","title":"...","text":"optional detail"}]}  (max 12 items; time optional)
{"type":"chart","title":"...","kind":"bar","labels":["Jan","Feb"],"series":[{"name":"Sales","data":[12,18]}],"unit":"","prefix":"Rs "}  (max 4 series, 24 labels)
{"type":"tabs","title":"...","tabs":[{"label":"...","content":"markdown"},{"label":"...","content":"markdown"}]}  (2-6 tabs)
{"type":"compare","title":"...","items":[{"name":"...","tag":"short tag","summary":"one line","points":["..."]},{"name":"...","summary":"one line","points":["..."]}]}  (2-4 items)
{"type":"quiz","title":"...","questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"explain":"why"}]}  (answer = index of the right option)
Never mention "neyo-ui", JSON or cards in your words; just say something natural in the user's language, like "change the number to see the result".`;
