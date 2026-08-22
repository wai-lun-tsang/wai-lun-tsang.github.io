/* DocketMaster — .ics (iCalendar) manual export/import
   No external library — the format is simple enough to generate/parse by hand,
   and this keeps the app fully offline-capable with zero dependencies.
*/

function pad(n) { return String(n).padStart(2, "0"); }

function toICSDateTime(dateStr, timeStr) {
  // dateStr "YYYY-MM-DD", timeStr "HH:MM" -> "YYYYMMDDTHHMMSS" (floating local time)
  const [y, m, d] = dateStr.split("-");
  const [hh, mm] = (timeStr || "09:00").split(":");
  return `${y}${m}${d}T${pad(hh)}${pad(mm)}00`;
}

function escapeICSText(str) {
  return String(str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function foldLine(line) {
  // iCalendar spec: lines >75 octets should be folded; kept simple for typical task titles.
  if (line.length <= 74) return line;
  let out = "";
  let rest = line;
  while (rest.length > 74) {
    out += rest.slice(0, 74) + "\r\n ";
    rest = rest.slice(74);
  }
  return out + rest;
}

function tasksToICS(tasks) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DocketMaster//Local Planner//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const t of tasks) {
    if (!t.scheduledDate) continue;
    const start = t.timeSlot?.start || "09:00";
    const durationMin = t.timeEstimateMinutes || 30;
    let endTime = t.timeSlot?.end;
    if (!endTime) {
      const [hh, mm] = start.split(":").map(Number);
      const totalMin = hh * 60 + mm + durationMin;
      endTime = `${pad(Math.floor(totalMin / 60) % 24)}:${pad(totalMin % 60)}`;
    }
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + t.id + "@docketmaster.local");
    lines.push("DTSTAMP:" + toICSDateTime(docketTodayStr(), "00:00") + "Z");
    lines.push(foldLine("SUMMARY:" + escapeICSText(t.title)));
    lines.push("DTSTART:" + toICSDateTime(t.scheduledDate, start));
    lines.push("DTEND:" + toICSDateTime(t.scheduledDate, endTime));
    if (t.notes) lines.push(foldLine("DESCRIPTION:" + escapeICSText(t.notes)));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadICS(icsText, filename = "docketmaster-export.ics") {
  const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function unfoldICS(text) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseICSDateTime(value) {
  // "YYYYMMDDTHHMMSS" or "YYYYMMDDTHHMMSSZ" or "YYYYMMDD"
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2}))?/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const time = m[4] ? `${m[5]}:${m[6]}` : null;
  return { date, time };
}

function icsToTasks(icsText) {
  const text = unfoldICS(icsText);
  const events = text.split("BEGIN:VEVENT").slice(1);
  const tasks = [];

  for (const block of events) {
    const body = block.split("END:VEVENT")[0];
    const getField = (name) => {
      const m = body.match(new RegExp(name + "[^:]*:(.*)"));
      return m ? m[1].trim() : null;
    };
    const summary = getField("SUMMARY");
    const dtstart = getField("DTSTART");
    const dtend = getField("DTEND");
    const description = getField("DESCRIPTION");
    if (!summary || !dtstart) continue;

    const start = parseICSDateTime(dtstart);
    const end = dtend ? parseICSDateTime(dtend) : null;
    if (!start) continue;

    let estimateMinutes = 30;
    let timeSlot = null;
    if (start.time && end?.time) {
      timeSlot = { start: start.time, end: end.time };
      const [sh, sm] = start.time.split(":").map(Number);
      const [eh, em] = end.time.split(":").map(Number);
      estimateMinutes = Math.max(5, (eh * 60 + em) - (sh * 60 + sm));
    }

    tasks.push(Tasks.blankTask({
      title: summary.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, "\n"),
      notes: description ? description.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, "\n") : "",
      status: "scheduled",
      scheduledDate: start.date,
      timeSlot,
      timeEstimateMinutes: estimateMinutes,
    }));
  }
  return tasks;
}

window.ICS = { tasksToICS, downloadICS, icsToTasks };
