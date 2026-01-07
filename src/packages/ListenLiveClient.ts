import { AbstractLiveClient } from "./AbstractLiveClient";
import { LiveTranscriptionEvents } from "../lib/enums";
import type { LiveSchema, LiveConfigOptions, DeepgramClientOptions } from "../lib/types";

/**
 * The `ListenLiveClient` class extends the `AbstractLiveClient` class and provides functionality for setting up and managing a WebSocket connection for live transcription.
 *
 * The constructor takes in `DeepgramClientOptions` and an optional `LiveSchema` object, as well as an optional `endpoint` string.
 * By default, the `endpoint` is set to `/v1/listen`.
 *
 * @example
 * const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
 * const transcription = deepgram.transcription.live({ model: "nova-2", language: "en-US" });
 *
 * transcription.on(LiveTranscriptionEvents.Transcript, (result) => {
 *   console.log(result);
 * });
 *
 * // Note: In a real application, you would typically send audio data to the server using `transcription.send()`
 * transcription.send("Hello, world!");
 */
export class ListenLiveClient extends AbstractLiveClient {
  public namespace: string = "listen";

  constructor(options: DeepgramClientOptions, schema: LiveSchema = {}, endpoint: string = "/:version/listen") {
    super(options);
    this.baseUrl = options.url || this.DEFAULT_TRANSCRIPTION_URL;
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

    const response = JSON.parse(event.data);
    this.emit(LiveTranscriptionEvents.Transcript, response);
  };
}
