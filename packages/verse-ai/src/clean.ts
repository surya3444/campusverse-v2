// What leaves for the model: tool output with phone numbers, emails and 12-digit identifiers
// (Aadhaar-like) removed, wrapped as data. Model and tool text is never trusted as instructions.

const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]'],
  [/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, '[phone removed]'],
  [/(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, '[identifier removed]'],
];

export function scrub(text: string): string {
  return PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text);
}

/** Tool output as the model sees it: scrubbed JSON inside a data marker. */
export function asData(toolName: string, data: unknown): string {
  return `<tool_output tool="${toolName}">\n${scrub(JSON.stringify(data))}\n</tool_output>`;
}
