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

  /**
   * Constructs a new `SpeakLiveClient` instance with the provided options.
   *
   * @param options - The `DeepgramClientOptions` to use for the client connection.
   * @param speakOptions - An optional `SpeakSchema` object containing additional configuration options for the text-to-speech.
   * @param endpoint - An optional string representing the WebSocket endpoint to connect to. Defaults to `:version/speak`.
   */
  constructor(
    options: DeepgramClientOptions,
    speakOptions: Omit<SpeakSchema, "container"> = {},
    endpoint: string = ":version/speak"
  ) {
    super(options);

    // Initialize health monitoring
    this.initializeHealthMonitoring("speak");

    this.connect(speakOptions, endpoint);
  }

  /**
   * Sets up the connection event handlers.
   * This method is responsible for handling the various events that can occur on the WebSocket connection, such as opening, closing, and receiving data.
   * - When the connection is opened, it emits the `LiveTTSEvents.Open` event.
   * - When the connection is closed, it emits the `LiveTTSEvents.Close` event.
   * - When an error occurs on the connection, it emits the `LiveTTSEvents.Error` event.
   * - When a message is received, it parses the message and emits the appropriate event based on the message type, such as `LiveTTSEvents.Metadata`, `LiveTTSEvents.Flushed`, and `LiveTTSEvents.Warning`.
   */
  public setupConnection(): void {
    // Set up standard connection events (open, close, error) using abstracted method
    this.setupConnectionEvents({
      Open: LiveTTSEvents.Open,
      Close: LiveTTSEvents.Close,
      Error: LiveTTSEvents.Error,
    });

    // Set up message handling specific to text-to-speech
    if (this.conn) {
      this.conn.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };
    }
  }

  /**
   * Handles text messages received from the WebSocket connection.
   * @param data - The parsed JSON data.
   */
  protected handleTextMessage(data: any): void {
    if (data.type === LiveTTSEvents.Metadata) {
      this.emit(LiveTTSEvents.Metadata, data);
    } else if (data.type === LiveTTSEvents.Flushed) {
      this.emit(LiveTTSEvents.Flushed, data);
    } else if (data.type === LiveTTSEvents.Warning) {
      this.emit(LiveTTSEvents.Warning, data);
    } else {
      this.emit(LiveTTSEvents.Unhandled, data);
    }
  }

  /**
   * Handles binary messages received from the WebSocket connection.
   * @param data - The binary data.
   */
  protected handleBinaryMessage(data: Buffer): void {
    this.emit(LiveTTSEvents.Audio, data);
  }

  /**
   * Handles incoming messages from the WebSocket connection.
   * @param event - The MessageEvent object representing the received message.
   */
  protected handleMessage(event: MessageEvent): void {
    // Record activity for health monitoring
    if (this.connectionHealth) {
      this.connectionHealth.recordActivity();
    }

    if (typeof event.data === "string") {
      try {
        const data = JSON.parse(event.data);
        this.handleTextMessage(data);
      } catch (error) {
        this.emit(LiveTTSEvents.Error, {
          event,
          message: "Unable to parse `data` as JSON.",
          error,
          url: this.conn?.url,
          readyState: this.conn?.readyState,
          data:
            event.data?.toString().substring(0, 200) +
            (event.data?.toString().length > 200 ? "..." : ""),
        });
      }
    } else if (event.data instanceof Blob) {
      event.data.arrayBuffer().then((buffer) => {
        this.handleBinaryMessage(Buffer.from(buffer));
      });
    } else if (event.data instanceof ArrayBuffer) {
      this.handleBinaryMessage(Buffer.from(event.data));
    } else if (Buffer.isBuffer(event.data)) {
      this.handleBinaryMessage(event.data);
    } else {
      console.log("Received unknown data type", event.data);
      this.emit(LiveTTSEvents.Error, {
        event,
        message: "Received unknown data type.",
        url: this.conn?.url,
        readyState: this.conn?.readyState,
        dataType: typeof event.data,
      });
    }
  }

  /**
   * Sends a text input message to the server.
   *
   * @param {string} text - The text to convert to speech.
   */
  public sendText(text: string): void {
    this.send(
      JSON.stringify({
        type: "Speak",
        text,
      })
    );
  }

  /**
   * Requests the server flush the current buffer and return generated audio.
   */
  public flush(): void {
    this.send(
      JSON.stringify({
        type: "Flush",
      })
    );
  }

  /**
   * Requests the server clear the current buffer.
   */
  public clear(): void {
    this.send(
      JSON.stringify({
        type: "Clear",
      })
    );
  }

  /**
   * Requests the server close the connection.
   */
  public requestClose(): void {
    this.send(
      JSON.stringify({
        type: "Close",
      })
    );
  }

  /**
   * Gets the namespace for this client.
   * @returns The namespace (speak)
   */
  protected getNamespace(): string {
    return "speak";
  }

  /**
   * Sends a KeepAlive message for Speak connections.
   */
  protected sendKeepAliveMessage(): void {
    this.send(JSON.stringify({ type: "KeepAlive" }));
  }
}
