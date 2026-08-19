/*
=========================================================
NEYO — VOICE INPUT AUDIO WORKLET

Purpose:
- Capture microphone audio off the main UI thread
- Send clean Float32 mono chunks back to voice.js
- Avoid ScriptProcessorNode stutter/deprecation

Does NOT own:
- resampling
- PCM16 conversion
- WebSocket
- Gemini
- UI
=========================================================
*/

class NeyoVoiceInputProcessor extends AudioWorkletProcessor {

    constructor(options) {
        super();

        const processorOptions =
            options?.processorOptions || {};

        this.targetChunkSize =
            Number(
                processorOptions.chunkSize
            ) || 2048;

        this.buffer =
            new Float32Array(
                this.targetChunkSize
            );

        this.offset =
            0;

        this.active =
            true;


        /* ---------------------------------------------
           Control messages from main thread
           --------------------------------------------- */

        this.port.onmessage =
            event => {

                const type =
                    event?.data?.type;


                if (
                    type === "stop"
                ) {

                    this.active =
                        false;

                    this.flush();

                } else if (
                    type === "start"
                ) {

                    this.active =
                        true;
                }
            };
    }


    /* =====================================================
       FLUSH PARTIAL BUFFER
       ===================================================== */

    flush() {

        if (
            this.offset <= 0
        ) {
            return;
        }


        const chunk =
            this.buffer.slice(
                0,
                this.offset
            );


        this.port.postMessage(
            {
                type:
                    "audio",

                samples:
                    chunk
            },
            [
                chunk.buffer
            ]
        );


        this.offset =
            0;
    }


    /* =====================================================
       PROCESS AUDIO
       ===================================================== */

    process(inputs) {

        if (
            !this.active
        ) {
            return true;
        }


        const input =
            inputs?.[0];


        if (
            !input ||
            input.length === 0
        ) {
            return true;
        }


        /*
        We only need mono voice.

        If browser provides multiple channels,
        use channel 0.
        */

        const channel =
            input[0];


        if (
            !channel ||
            channel.length === 0
        ) {
            return true;
        }


        let sourceOffset =
            0;


        while (
            sourceOffset <
            channel.length
        ) {

            const remainingTarget =
                this.targetChunkSize -
                this.offset;


            const remainingSource =
                channel.length -
                sourceOffset;


            const copyLength =
                Math.min(
                    remainingTarget,
                    remainingSource
                );


            this.buffer.set(
                channel.subarray(
                    sourceOffset,
                    sourceOffset +
                    copyLength
                ),
                this.offset
            );


            this.offset +=
                copyLength;


            sourceOffset +=
                copyLength;


            /*
            Full chunk ready.
            */

            if (
                this.offset >=
                this.targetChunkSize
            ) {

                const chunk =
                    this.buffer;


                this.port.postMessage(
                    {
                        type:
                            "audio",

                        samples:
                            chunk
                    },
                    [
                        chunk.buffer
                    ]
                );


                /*
                New buffer required because ownership
                of old ArrayBuffer moved to main thread.
                */

                this.buffer =
                    new Float32Array(
                        this.targetChunkSize
                    );


                this.offset =
                    0;
            }
        }


        return true;
    }
}


/* =========================================================
   REGISTER
   ========================================================= */

registerProcessor(
    "neyo-voice-input-processor",
    NeyoVoiceInputProcessor
);
