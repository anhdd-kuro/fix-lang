import type React from "react";

/**
 * Turns a keydown into the accelerator string electron's `globalShortcut`
 * expects ("Control+Shift+F"). Shared by the preset editor and the combo
 * editor, which live in separate Settings tabs but must produce byte-identical
 * accelerators — `validateHotkeys` compares them as strings, so a second
 * hand-rolled capture would let a combo and a preset hold what looks like the
 * same chord and pass conflict validation.
 */
export const captureHotkey = (
  event: React.KeyboardEvent<HTMLInputElement>,
): string => {
  event.preventDefault();

  const parts: string[] = [];

  if (event.ctrlKey) parts.push("Control");
  if (event.metaKey) parts.push("Command");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;

  if (!["Control", "Command", "Alt", "Shift"].includes(key)) {
    parts.push(key);
  }

  return parts.join("+");
};
