"use client";

// The settings resource modals (Skills / Prompts) and the models-config panel
// share the settings control skin. This module used to own a second, older copy
// of it; it is now a re-export of `../controls` so there is one definition.
//
// Behavior and props are unchanged — only the skin moved.
export * from "../controls";