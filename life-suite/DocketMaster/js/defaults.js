/* DocketMaster — default tags, settings, and first-run seeding */

const DEFAULT_TAGS = [
  { name: "Core Learning", color: "#3E7CB1" },
  { name: "Extra Learning", color: "#5FB4E0" },
  { name: "Assessments", color: "#E6473C" },
  { name: "Leisure", color: "#6FB552" },
  { name: "Medical", color: "#3FA796" },
  { name: "Social", color: "#F2994A" },
  { name: "Trading", color: "#E0A526" },
  { name: "Wellbeing & Workout", color: "#8E6FCE" },
  { name: "Birthdays", color: "#E85D9E" },
];

const DEFAULT_SETTINGS = {
  key: "settings",
  weekStartsOn: 0, // 0 = Sunday
  timezone: "Europe/London",
  timerDefaults: { pomodoroWorkMin: 50, pomodoroBreakMin: 10 },
  alerts: { sound: true, visual: true, vibrate: true },
  completion: { stamp: true, sound: true },
};

async function seedIfNeeded() {
  const existingTags = await DocketDB.getAll("tags");
  if (existingTags.length === 0) {
    for (let i = 0; i < DEFAULT_TAGS.length; i++) {
      const t = DEFAULT_TAGS[i];
      await DocketDB.put("tags", { id: docketUid(), name: t.name, color: t.color, order: i });
    }
  }

  const existingSettings = await DocketDB.get("settings", "settings");
  if (!existingSettings) {
    await DocketDB.put("settings", DEFAULT_SETTINGS);
  }
}

window.DEFAULT_TAGS = DEFAULT_TAGS;
window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
window.seedIfNeeded = seedIfNeeded;
