export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
    }
  }
  if (typeof document === "undefined" || !document.body) {
    throw new Error("clipboard unavailable");
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  ta.setAttribute("readonly", "");
  document.body.appendChild(ta);
  const selection = document.getSelection();
  const savedRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  if (savedRange && selection) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }
  if (!ok) throw new Error("clipboard unavailable");
}
