// Runs the on-device AI model (WebLLM) off the main thread, so the page stays responsive while it thinks.
// Loaded only after a visitor turns AI answers on (see engine/ai.js).

import { WebWorkerMLCEngineHandler } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message) => handler.onmessage(message);
