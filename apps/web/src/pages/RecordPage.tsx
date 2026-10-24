import { useEffect, useMemo, useState } from "react";
import { MAX_SPEECH_SECONDS, isSpeechless, parseTransactionText } from "@libellum/shared";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { VoiceRipples } from "../components/VoiceRipples.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { displayPaymentMethodName } from "../lib/presetNames.js";
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

/**
 * 说明里的示例句。**识别语言是中文**（转写按中文、解析按中文关键词），所以英文界面也保持
 * 这句中文示例，只翻译它周围的说明。
 */
const SPOKEN_EXAMPLE = "午饭 38"; // i18n-ignore：识别语言（中文）的示例，不随界面语言变化

export function RecordPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useI18n();
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
      title={t("capture.record.title")}
      subtitle={t("capture.record.subtitle", { example: SPOKEN_EXAMPLE })}
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
          <span className="text-center text-base font-medium text-ink">
            {recorder.state === "starting"
              ? t("capture.record.preparing")
              : recording
                ? t("capture.record.recording")
                : transcribe.isSuccess
                  ? t("capture.record.again")
                  : t("capture.record.start")}
          </span>

          <span className="text-helper text-muted">
            {recording
              ? t("capture.record.secondsLeft", { count: recorder.secondsLeft })
              : t("capture.record.maxSeconds", { count: MAX_SPEECH_SECONDS })}
          </span>
        </span>
      </button>

      {recorder.supported ? null : (
        <Alert tone="info">{describeBlocker(recorder.blocker) ?? ""}</Alert>
      )}

      {transcribe.isPending ? (
        <p className="text-center text-body text-muted">{t("capture.recognizing")}</p>
      ) : null}

      {heardNothing ? (
        <Alert tone="info">{t("capture.record.heardNothing")}</Alert>
      ) : null}

      {transcribe.isSuccess && !heardNothing && transcribe.data.text !== "" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-card-title text-ink">{t("capture.record.heardTitle")}</h2>

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
                ? t("capture.record.noAmount")
                : t("capture.record.amountChip", {
                    kind: t(parsed.kind === "income" ? "common.kind.income" : "common.kind.expense"),
                    amount: parsed.amount,
                  })}
            </span>
            {/* 商户、备注是听到的原文（数据），原样显示；支付方式只在是预置名时显示译名。 */}
            {parsed?.merchant == null ? null : (
              <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">
                {t("capture.record.merchantChip", { value: parsed.merchant })}
              </span>
            )}
            {parsed?.paymentMethod == null ? null : (
              <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">
                {t("capture.record.paymentChip", { value: displayPaymentMethodName(parsed.paymentMethod) })}
              </span>
            )}
            {parsed?.occurredLocalDate == null ? null : (
              <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">
                {t("capture.record.dateChip", { value: parsed.occurredLocalDate })}
              </span>
            )}
            {parsed === null || parsed.note === "" ? null : (
              <span className="rounded-full bg-canvas px-3 py-1.5 text-muted">
                {t("capture.record.noteChip", { value: parsed.note })}
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
            {t("capture.record.review")}
          </Button>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => void navigate("/add")}
        className="text-helper text-muted underline"
      >
        {t("capture.record.manualFallback")}
      </button>
    </InnerPage>
  );
}
