"use client";

import { useEffect, useState } from "react";
import { registerPiWorkDarkTheme } from "@/lib/client/monaco-theme";

type Monaco = typeof import("monaco-editor");

export interface MonacoLoaderState {
	monaco: Monaco | null;
	loading: boolean;
	error: Error | null;
	retry: () => void;
}

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

function configureMonacoEnvironment(): void {
	if (typeof window === "undefined") return;
	if (window.MonacoEnvironment) return;
	window.MonacoEnvironment = { getWorker: () => makeNoopWorker() };
}

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

let pendingLoad: Promise<Monaco> | null = null;

function loadMonaco(): Promise<Monaco> {
	if (pendingLoad) return pendingLoad;
	configureMonacoEnvironment();
	patchWheelListenersForMonaco();
	pendingLoad = import("monaco-editor").then((m) => {
		registerPiWorkDarkTheme(m);
		return m;
	});
	return pendingLoad;
}

export function useMonacoLoader(): MonacoLoaderState {
	const [monaco, setMonaco] = useState<Monaco | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		if (monaco || error) return;
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
		pendingLoad = null;
		setError(null);
		setMonaco(null);
		setLoading(false);
	};

	return { monaco, loading, error, retry };
}