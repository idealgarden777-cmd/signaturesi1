import test from "node:test";
import assert from "node:assert/strict";
import {
    normalizeCard,
    parseCardSource,
    cleanTarget,
    clockText,
    splitDuration,
    pomodoroPhase,
    cardToText
} from "../public/js/components/smart-ui-core.js";
import { SMART_UI_RULE } from "../lib/smart-ui.js";

test("live ui: clock with world zones, bad zones dropped", () => {
    const card = normalizeCard({
        type: "view",
        title: "World clock",
        blocks: [{ type: "clock", style: "both", zones: [{ label: "Lahore", tz: "Asia/Karachi" }, "Europe/London", { label: "Mars", tz: "Mars/Olympus" }] }]
    });
    const clock = card.blocks[0];
    assert.equal(clock.type, "clock");
    assert.equal(clock.style, "both");
    assert.deepEqual(clock.zones.map(z => z.tz), ["Asia/Karachi", "Europe/London"]);
    assert.equal(clock.hour12, true);
    assert.equal(clock.seconds, true);

    const local = normalizeCard({ type: "clock" });
    assert.equal(local.type, "view", "a bare clock card is wrapped into a view");
    assert.deepEqual(local.blocks[0].zones, [{ label: "", tz: "" }]);
    assert.equal(normalizeCard({ type: "worldclock", timezones: ["Asia/Dubai"], format: "24h" }).blocks[0].hour12, false);
});

test("live ui: countdown targets are real dates only", () => {
    assert.equal(cleanTarget("2026-12-31"), "2026-12-31T00:00:00");
    assert.equal(cleanTarget("2027-05-16T00:00:00+05:00"), "2027-05-16T00:00:00+05:00");
    assert.equal(cleanTarget("2026-12-31 18:30"), "2026-12-31T18:30");
    assert.equal(cleanTarget("next friday"), "");
    assert.equal(cleanTarget("2026-13-45"), "");
    assert.equal(normalizeCard({ type: "countdown", to: "soon" }), null);
    const card = normalizeCard({ type: "countdown", label: "New Year", to: "2099-01-01" });
    assert.equal(card.blocks[0].done, "Time's up!");
    assert.match(cardToText(card), /New Year: \d+d \d+h \d+m left/);
});

test("live ui: timer, pomodoro and stopwatch shapes", () => {
    const timer = normalizeCard({ type: "timer", minutes: 9999, presets: [1, 3, -2, "5", 900] }).blocks[0];
    assert.equal(timer.minutes, 600);
    assert.deepEqual(timer.presets, [1, 3, 5]);
    const pomo = normalizeCard({ type: "pomodoro", rounds: 2 }).blocks[0];
    assert.equal(pomo.mode, "pomodoro");
    assert.equal(pomo.work, 25);
    assert.equal(normalizeCard({ type: "stopwatch" }).blocks[0].laps, true);
    const parsed = parseCardSource('{"type":"view","blocks":[{"type":"grid","cols":2,"blocks":[{"type":"clock"},{"type":"timer","mode":"pomodoro"}]}]}');
    assert.equal(parsed.card.blocks[0].blocks.length, 2);
});

test("live ui: time maths", () => {
    assert.deepEqual(splitDuration(90061000), { days: 1, hours: 1, minutes: 1, seconds: 1 });
    assert.deepEqual(splitDuration(-5), { days: 0, hours: 0, minutes: 0, seconds: 0 });
    assert.equal(clockText(65000, { hours: false }), "01:05");
    assert.equal(clockText(3725000, { hours: false }), "1:02:05");
    assert.equal(clockText(1234, { hours: false, tenths: true }), "00:01.2");

    const block = { work: 25, short: 5, long: 15, rounds: 2 };
    assert.equal(pomodoroPhase(block, 0).kind, "work");
    assert.equal(pomodoroPhase(block, 25 * 60000).kind, "short");
    const second = pomodoroPhase(block, 31 * 60000);
    assert.equal(second.kind, "work");
    assert.equal(second.round, 2);
    assert.equal(second.remaining, 24 * 60000);
    assert.equal(pomodoroPhase(block, 55 * 60000).kind, "long");
    assert.equal(pomodoroPhase(block, 71 * 60000).done, true);
});

test("live ui: the model is told these run for real", () => {
    assert.match(SMART_UI_RULE, /"type":"clock"/);
    assert.match(SMART_UI_RULE, /"mode":"pomodoro"/);
    assert.match(SMART_UI_RULE, /never write an "example"/);
});
