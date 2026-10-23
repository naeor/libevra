import { useEffect, useMemo, useState } from "react";
import { MAX_SPEECH_SECONDS, isSpeechless, parseTransactionText } from "@libellum/shared";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { VoiceRipples } from "../components/VoiceRipples.js";
import { errorMessage } from "../lib/api.js";
import { useLedger, useTranscribe } from "../lib/queries.js";
import { handOverSpoken } from "../lib/scanHandoff.js";
import { describeBlocker, useVoiceRecorder, type Recording } from "../lib/useVoiceRecorder.js";

/**
 * Recording a spoken entry.
 *
 * ⚠️ **There is no browser-drawn recorder, unlike the camera.** `getUserMedia`
 * and `MediaRecorder` are plain APIs with no native interface, so every part of
 * this screen is ours — which is why the owner could ask for a particular look
 * rather than describing what Safari gave him.
 *
 * What the screen does, in order:
 *
 *  1. **Before recording**: five straight lines and one large button. The lines
 *     are the target of the tap as well as the picture, so the whole panel reads
 *     as the thing to press.
 *  2. **While recording**: the lines move with the actual microphone level, the
 *     seconds count down from thirty, and the button becomes "停止".
 *  3. **After recording**: what was heard, **editable**, with the fields it was
 *     read into. Then either 去核对 (opens the manual form, filled in) or
 *     重录一遍.
 *
 * The editable text is the trust mechanism, and the owner asked for it in those
 * terms. Somebody who can read back "午饭 38" knows whether they were heard;
 * somebody shown a filled-in form cannot tell whether it was heard or guessed.
 */
export function RecordPage(): React.JSX.Element {
  const navigate = useNavigate();
  const transcribe = useTranscribe();
  const ledger = useLedger();
  const categories = useMemo(() => ledger.data?.categories ?? [], [ledger.data?.categories]);

  const recorder = useVoiceRecorder((recording: Recording) => {
    transcribe.mutate(recording.blob);
  });

  /**
   * A recording that produced nothing gets a sentence of its own.
   *
   * Not an error — the microphone worked, there was just nothing to hear — and
   * the difference matters: "再录一次" is the answer here, where an error banner
   * would suggest something is broken.
   */
  const heardNothing = transcribe.isSuccess && isSpeechless(transcribe.data.text);

  /** The text as the user has edited it, once they have touched it. */
  const [editedText, setEditedText] = useState<string | null>(null);

  useEffect(() => {
    // A new transcription replaces the old edits: keeping them would apply one
    // recording's corrections to another one's words.
    setEditedText(null);
  }, [transcribe.data]);

  /**
   * Re-run the **same** shared parser on the text as it is now.
   *
   * This is the architecture's main payoff and the owner asked for it in those
   * terms: correcting what Whisper heard must not require another upload or
   * another inference. The API's parse is only a starting point — the browser
   * re-parses with the user's local clock, because "昨天" depends on where the
   * user is, not on the server's timezone.
   */
  const parsed = useMemo(() => {
    if (transcribe.data === undefined || transcribe.data.text === "") return null;

    const text = (editedText ?? transcribe.data.text).trim();
    if (text === "") return null;

    return parseTransactionText(text, { categories, now: new Date() });
  }, [transcribe.data, editedText, categories]);

  const recording = recorder.state === "recording";
  const busy = recorder.state === "starting" || recorder.state === "stopping" || transcribe.isPending;

  return (
    <InnerPage
      title="语音记账"
      subtitle="说一句花了多少，比如「午饭 38」。说完会自动转成文字，你可以先核对再记。"
      backTo="/"
    >
      {recorder.error === null ? null : <Alert tone="error">{recorder.error}</Alert>}
      {transcribe.isError ? <Alert tone="error">{errorMessage(transcribe.error)}</Alert> : null}

      {/*
        The panel. Its whole surface starts and stops the recording: the button is
        the obvious target and the ripples are what the eye is on, so making only
        a small control work would send taps to a dead area on a screen whose
        entire purpose is one press.
      */}
      <button
        type="button"
        /**
         * ⚠️ **Not disabled after a transcription, and that was a real bug.**
         *
         * The condition used to include `transcribe.isSuccess`, so once a
         * recording had been read the panel was dead — while its own label read
         * "点击重新录一遍". The owner pressed it and nothing happened.
         *
         * A screen that offers an action and refuses it is worse than one that
         * never offered it: the user is left working out whether the app is
         * broken or they misread, and here the label was telling them the
         * opposite of the truth.
         *
         * `busy` alone is the honest gate — starting, stopping, or waiting for a
         * transcription. Those are the three states where a second press would
         * do something surprising.
         */
        disabled={busy}
        onClick={() => {
          if (recording) {
            recorder.stop();
            return;
          }

          setEditedText(null);
          transcribe.reset();
          void recorder.start();
        }}
        className="flex w-full flex-col items-center gap-5 rounded-card border border-line bg-surface px-6 py-8 transition disabled:opacity-45"
      >
        <VoiceRipples level={recorder.level} active={recording} />

        <span className="flex flex-col items-center gap-1">
          <span className="text-base font-medium text-ink">
            {recorder.state === "starting"
              ? "正在准备麦克风…"
              : recording
                ? "正在录音，点击停止"
                : transcribe.isSuccess
                  ? "点击重新录一遍"
                  : "点击开始录音"}
          </span>

          <span className="text-helper text-muted">
            {recording
              ? `还可以录 ${String(recorder.secondsLeft)} 秒`
              : `每段最多 ${String(MAX_SPEECH_SECONDS)} 秒`}
          </span>
        </span>
      </button>

      {recorder.supported ? null : (
        <Alert tone="info">{describeBlocker(recorder.blocker) ?? ""}</Alert>
      )}

      {transcribe.isPending ? (
        <p className="text-center text-body text-muted">正在识别…</p>
      ) : null}

      {heardNothing ? (
        <Alert tone="info">没有听清。可以靠近一点、说大声一点，或者改用手动记账。</Alert>
      ) : null}

      {transcribe.isSuccess && !heardNothing && transcribe.data.text !== "" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-card-title text-ink">听到的内容（可以修改）</h2>

          <textarea
            value={editedText ?? transcribe.data.text}
            onChange={(event) => {
              setEditedText(event.target.value);
            }}
            rows={2}
            className="w-full rounded-field border border-line bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-brand"
          />

          {/*
            What was read out of the sentence, shown rather than applied. The
            fields are filled in on the next screen, where they can be corrected
            beside the rest of the entry — this is the user checking that they
            were heard, not a second form to fill in.
          */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-brand-soft px-3 py-1.5 text-brand-dark">
              {parsed === null || parsed.amount === null
                ? "没听到金额"
                : `${parsed.kind === "income" ? "收入" : "支出"} ${parsed.amount}`}
            </span>
            {parsed?.merchant == null ? null : (
              <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">
                商户：{parsed.merchant}
              </span>
            )}
            {parsed?.paymentMethod == null ? null : (
              <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">
                支付：{parsed.paymentMethod}
              </span>
            )}
            {parsed?.occurredLocalDate == null ? null : (
              <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">
                日期：{parsed.occurredLocalDate}
              </span>
            )}
            {parsed === null || parsed.note === "" ? null : (
              <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">
                备注：{parsed.note}
              </span>
            )}
          </div>

          <Button
            onClick={() => {
              /**
               * To the review form, filled in from what was heard.
               *
               * In memory rather than in the URL: the sentence is somebody's own
               * words about their own spending, and a query string puts it in the
               * browser's history where it outlives the entry they decided not to
               * save. The handover is read once and emptied as it is read, so a
               * refresh or a back press finds nothing and the review screen says
               * so rather than showing an empty form.
               */
              const text = (editedText ?? transcribe.data.text).trim();
              if (parsed === null) return;

              handOverSpoken({ text, parsed, source: "voice" });
              void navigate("/voice/review");
            }}
          >
            去核对并记账
          </Button>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => void navigate("/add")}
        className="text-helper text-muted underline"
      >
        语音不方便？直接手动记账
      </button>
    </InnerPage>
  );
}
