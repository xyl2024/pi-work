export function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const frames = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = frames.pop() ?? "";
  const events: string[] = [];
  for (const frame of frames) {
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    if (dataLines.length > 0) events.push(dataLines.join("\n"));
  }
  return { events, rest };
}
