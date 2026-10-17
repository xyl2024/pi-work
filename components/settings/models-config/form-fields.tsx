"use client";

// The models-config panel shares the settings control skin with the settings
// sections and modals. This module used to own a second, older copy
// of it; it is now a re-export of `../controls` so there is one definition.
//
// Behavior and props are unchanged — only the skin moved.
export * from "../controls";