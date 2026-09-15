import { useRef, useState, useCallback } from 'react';

/**
 * Hybrid voice input:
 * 1. Web Speech API gives live interim text (instant feedback, rough)
 * 2. On stop, sends full audio to Gemini 2.5 Flash for a perfect final transcription
 * 3. Fallback: server-only mode for Firefox (no SpeechRecognition)
 */
export function useVoiceInput(onTranscript: (text: string, isFinal?: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false); // final pass in progress
  const [bars, setBars] = useState<number[]>([0, 0, 0, 0, 0]);

  const on = useRef(false);
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('audio/webm');
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const cb = useRef(onTranscript);
  cb.current = onTranscript;

  const stopVisualizer = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setBars([0, 0, 0, 0, 0]);
  }, []);

  const startVisualizer = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.75;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const d = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (!on.current) return;
        analyser.getByteFrequencyData(d);
        setBars([3, 6, 10, 15, 20].map(i => Math.min(1, (d[i] || 0) / 180)));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      return stream;
    } catch (_) {
      return null;
    }
  }, []);

  // Send audio to Gemini 2.5 Flash for precise transcription
  const geminiTranscribe = useCallback(async (blob: Blob): Promise<string> => {
    if (blob.size < 3000) return '';
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1] || '');
        reader.readAsDataURL(blob);
      });
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, mimeType: blob.type }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      return data.text || '';
    } catch (_) {
      return '';
    }
  }, []);

  const kill = useCallback(async (doFinalTranscription = true) => {
    on.current = false;
    setListening(false);

    // Stop speech recognition
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) {}
      recognitionRef.current = null;
    }

    // Stop recorder
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch (_) {}
    }

    stopVisualizer();

    // Final Gemini transcription
    if (doFinalTranscription && chunksRef.current.length > 0) {
      setTranscribing(true);
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
      const finalText = await geminiTranscribe(blob);
      setTranscribing(false);
      if (finalText) {
        cb.current(finalText, true);
      }
    }

    chunksRef.current = [];
    recorderRef.current = null;
  }, [stopVisualizer, geminiTranscribe]);

  const go = useCallback(async () => {
    if (on.current) return;

    // Flip state + start SpeechRecognition IMMEDIATELY so live text appears
    // with no perceptible lag. It requests its own mic and doesn't need to
    // wait for getUserMedia / AudioContext (those run in parallel below).
    on.current = true;
    setListening(true);
    chunksRef.current = [];

    // Web Speech API for live interim preview — started first (fastest path)
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'fr-FR';
      recognition.maxAlternatives = 1;

      let finalAccum = '';

      recognition.onresult = (event: any) => {
        let finals = '';
        let interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finals += r[0].transcript + ' ';
          else interim += r[0].transcript;
        }
        finalAccum = finals.trimEnd();
        const preview = (finalAccum + (interim ? ' ' + interim : '')).trim();
        if (preview) cb.current(preview, false); // interim, not final
      };

      recognition.onerror = (e: any) => {
        if (e.error === 'not-allowed') kill(true);
      };

      recognition.onend = () => {
        if (on.current) {
          try { recognition.start(); } catch (_) {}
        }
      };

      try { recognition.start(); } catch (_) {}
    }

    // Visualizer + MediaRecorder set up in parallel (non-blocking) so they
    // never delay the live dictation start.
    const stream = await startVisualizer();
    if (!stream || !on.current) return;

    // Start MediaRecorder to capture audio for Gemini
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
    mimeTypeRef.current = mimeType;

    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(); // collect all audio, no timeslice
    } catch (e) {
      console.error('[voice] MediaRecorder error:', e);
    }
  }, [startVisualizer, kill]);

  const toggle = useCallback(() => {
    if (on.current) kill(true);
    else go();
  }, [kill, go]);

  return {
    isListening: listening,
    isTranscribing: transcribing,
    voiceBars: bars,
    toggle,
    startListening: go,
    stopListening: () => kill(true),
  };
}
