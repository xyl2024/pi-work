"use client";

// Lazy Monaco loader + worker setup.
//
// Monaco's bundle is ~3 MB minified for the editor core alone; we don't
// want to ship it on the initial page load. Instead, the first time
// `useMonacoLoader()` is called (i.e. when the right-side viewer mounts
// and the user opens a text file), we:
//
//   1. install a `MonacoEnvironment.getWorker` factory on `window` so
//      workers resolve to webpack-bundled chunks (see comments on
//      configureMonacoEnvironment below);
//   2. dynamic-`import("monaco-editor")`;
//   3. resolve with the `monaco-editor` namespace module.
//
// On failure the caller gets `{ monaco: null, error }` and can render a
// retry button — see the design notes for the right-side viewer.

import { useEffect, useState } from "react";

type Monaco = typeof import("monaco-editor");

export interface MonacoLoaderState {
	monaco: Monaco | null;
	loading: boolean;
	error: Error | null;
	retry: () => void;
}

// `MonacoEnvironment` is declared globally by monaco-editor itself
// (see node_modules/monaco-editor/monaco.d.ts) so we can refer to it
// directly without redeclaring it here.

/**
 * Build a no-op Worker for Monaco.
 *
 * Monaco's worker code uses `importScripts` to lazily pull in language
 * modules (typescript compiler, json schema, etc.), and it depends on
 * `MonacoEnvironment.baseUrl` being set so it can build the worker-
 * relative URLs. With webpack's `new Worker(new URL(..., import.meta.url), { type: "module" })`
 * pattern the worker is an ES module worker — `importScripts` doesn't
 * exist there, and `MonacoEnvironment.baseUrl` is undefined inside
 * the worker scope, so any language-service request (TS validation,
 * JSON schema, hover, autocomplete) crashes with `asBrowserUri(...)`
 * returning `undefined`.
 *
 * Trade-off: we lose Monaco's language services (IntelliSense, type
 * checking, JSON schema validation). Syntax highlighting, folding,
 * bracket matching, multi-cursor, find-in-editor, etc. all keep
 * working because they run on the main thread. For Pi Work's
 * right-side viewer — read-mostly preview with optional small edits
 * — this is the right trade: we get Monaco's chrome without paying
 * for worker plumbing that's known-fragile under Next.js' webpack
 * config.
 *
 * The blob worker accepts `postMessage` and silently drops everything,
 * which is exactly what Monaco expects when no language worker is
 * available — the editor just runs without language services.
 */
function makeNoopWorker(): Worker {
	const code = `
		self.onmessage = function () {};
		// Monaco occasionally pings workers to confirm they're alive;
		// respond with a no-op ack so it doesn't think we crashed.
		self.postMessage({});
	`;
	const url = URL.createObjectURL(
		new Blob([code], { type: "application/javascript" }),
	);
	return new Worker(url);
}

/**
 * Install `window.MonacoEnvironment` once. Subsequent calls are
 * no-ops — Monaco caches the worker factory on first use, and we don't
 * want to thrash it. `window.MonacoEnvironment` is typed by
 * monaco-editor's own .d.ts (see `interface Window { ... }`).
 *
 * Returns a fresh no-op worker for every label. Monaco occasionally
 * creates multiple workers (e.g. one per language), so we can't
 * memoize a single instance — each request gets its own blob URL.
 * The blob URLs are tiny and freed by the browser when the worker
 * is GC'd.
 */
function configureMonacoEnvironment(): void {
	if (typeof window === "undefined") return;
	if (window.MonacoEnvironment) return;
	window.MonacoEnvironment = { getWorker: () => makeNoopWorker() };
}

/**
 * Patch the browser's `addEventListener` so wheel listeners on Monaco's
 * DOM subtrees are registered with `passive: false`.
 *
 * Background: Monaco's viewController calls `preventDefault()` on wheel
 * events to keep the page from scrolling while the user is scrolling
 * inside the editor. Chrome (since ~2017) and Firefox auto-promote
 * wheel listeners on root / window / body to passive, so the call is
 * a no-op and the browser logs
 * `Unable to preventDefault inside passive event listener invocation.`
 * every time the user scrolls. Functional impact: zero (Monaco also
 * listens on its canvas directly and that path still works), but the
 * console noise masks real warnings.
 *
 * Scope: we only rewrite `wheel` listeners registered by Monaco. We
 * detect that by checking that the target lives inside a Monaco
 * editor container (a `[role="code"]` or `.monaco-editor` ancestor).
 * Anything else — including the page's own scroll handlers — keeps
 * its original passive / non-passive choice.
 */
function patchWheelListenersForMonaco(): void {
	if (typeof window === "undefined") return;
	if ((window as unknown as { __piMonacoWheelPatched?: boolean }).__piMonacoWheelPatched) return;

	const native = EventTarget.prototype.addEventListener;
	EventTarget.prototype.addEventListener = function patchedAdd(
		this: EventTarget,
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		if (type === "wheel" && listener && isMonacoElement(this)) {
			const opts: AddEventListenerOptions =
				typeof options === "boolean"
					? { capture: options, passive: false }
					: { ...(options ?? {}), passive: false };
			native.call(this, type, listener, opts);
			return;
		}
		native.call(this, type, listener, options);
	} as typeof EventTarget.prototype.addEventListener;

	(window as unknown as { __piMonacoWheelPatched?: boolean }).__piMonacoWheelPatched = true;
}

function isMonacoElement(target: EventTarget): boolean {
	if (!(target instanceof Element)) return false;
	return !!target.closest(".monaco-editor, [role='code'], [aria-roledescription='editor']");
}

/**
 * Use `useMonacoLoader()` from the right-side viewer. Each component
 * instance gets its own load attempt; we share state via a module-level
 * promise so the second mount just awaits the in-flight import instead
 * of triggering a second download.
 */
let pendingLoad: Promise<Monaco> | null = null;

function loadMonaco(): Promise<Monaco> {
	if (pendingLoad) return pendingLoad;
	configureMonacoEnvironment();
	patchWheelListenersForMonaco();
	pendingLoad = import("monaco-editor");
	return pendingLoad;
}

export function useMonacoLoader(): MonacoLoaderState {
	const [monaco, setMonaco] = useState<Monaco | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		if (monaco || error) return;
		// If a previous component already kicked off the load, attach
		// to the shared promise and mirror its full settled state.
		if (pendingLoad) {
			setLoading(true);
			pendingLoad
				.then((m) => {
					setMonaco(m);
					setLoading(false);
				})
				.catch((e: unknown) => {
					setError(e instanceof Error ? e : new Error(String(e)));
					setLoading(false);
				});
			return;
		}
		setLoading(true);
		loadMonaco()
			.then((m) => {
				setMonaco(m);
				setLoading(false);
			})
			.catch((e: unknown) => {
				setError(e instanceof Error ? e : new Error(String(e)));
				setLoading(false);
			});
	}, [monaco, error]);

	const retry = () => {
		// Reset module-level promise so the next effect run re-imports.
		pendingLoad = null;
		setError(null);
		setMonaco(null);
		setLoading(false);
	};

	return { monaco, loading, error, retry };
}

/** Test seam: clear the cached load promise. */
export function __resetMonacoLoaderForTests(): void {
	pendingLoad = null;
}