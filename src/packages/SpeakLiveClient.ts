import { AbstractLiveClient } from "./AbstractLiveClient";
import { LiveTTSEvents } from "../lib/enums";
import type { SpeakSchema, DeepgramClientOptions } from "../lib/types";

/**
 * The `SpeakLiveClient` class extends the `AbstractLiveClient` class and provides functionality for setting up and managing a WebSocket connection for live text-to-speech synthesis.
 *
 * The constructor takes in `DeepgramClientOptions` and an optional `SpeakSchema` object, as well as an optional `endpoint` string.
 * By default, the `endpoint` is set to `/v1/speak`.
 *
 * @example
 * const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
 * const tts = deepgram.speak.live({ model: "aura-asteria-en" });
 *
 * tts.on(LiveTTSEvents.Open, () => {
 *   tts.send("Hello, world!");
 * });
 *
 * tts.on(LiveTTSEvents.Audio, (result) => {
 *   const buffer = Buffer.from(result.data, "base64");
 *   // Process audio buffer
 * });
 */
export class SpeakLiveClient extends AbstractLiveClient {
  public namespace: string = "speak";

  constructor(options: DeepgramClientOptions, schema: SpeakSchema = {}, endpoint: string = "/:version/speak") {
    super(options);
    this.baseUrl = options.url || this.DEFAULT_SPEAK_URL;
    this.endpoint = endpoint;
    this.schema = schema;
  }

  /**
   * Event handler for incoming messages
   */
  onmessage = (event: MessageEvent): void => {
    // Record activity for health monitoring
    if (this.connectionHealth) {
      this.connectionHealth.recordActivity();
    }

    this.emit(LiveTTSEvents.Audio, {
      data: event.data,
    });
  };
}
