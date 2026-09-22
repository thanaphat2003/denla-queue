import { useEffect, useState, useCallback, useRef } from 'react';
import { getAdminSettings, getDisplayData } from '../api.js';
import socket from '../socket.js';
import Logo from '../components/Logo.jsx';

function speak(text, language = 'TH', settings = {}, onFinished) {
  if (!('speechSynthesis' in window)) {
    onFinished();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'EN' ? 'en-US' : 'th-TH';
  utterance.rate = Math.min(2, Math.max(0.5, Number(settings.queueSpeechRate) || 0.95));
  const voiceName = language === 'EN' ? settings.queueVoiceEn : settings.queueVoiceTh;
  const voice = window.speechSynthesis.getVoices().find((item) => item.name === voiceName);
  if (voice) utterance.voice = voice;
  let finished = false;
  const finishOnce = () => {
    if (finished) return;
    finished = true;
    onFinished();
  };
  utterance.onend = finishOnce;
  utterance.onerror = finishOnce;
  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);
}

export default function DisplayPage() {
  const [data, setData] = useState({ counters: [], calling: [], waiting: [], skipped: [] });
  const [voiceSettings, setVoiceSettings] = useState({ queueVoiceTh: '', queueVoiceEn: '', queueSpeechRate: '0.95' });
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(true);
  const voiceSettingsRef = useRef(voiceSettings);
  const speechQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const speechEnabledRef = useRef(false);
  const receivedEventIdsRef = useRef(new Set());

  const playNextSpeech = useCallback(() => {
    if (!speechEnabledRef.current || isSpeakingRef.current) return;
    const next = speechQueueRef.current.shift();
    if (!next) return;
    isSpeakingRef.current = true;
    speak(next.text, next.language, voiceSettingsRef.current, () => {
      isSpeakingRef.current = false;
      playNextSpeech();
    });
  }, []);

  const enableSpeech = useCallback(() => {
    speechEnabledRef.current = true;
    setSpeechEnabled(true);
    window.speechSynthesis?.resume();
    playNextSpeech();
  }, [playNextSpeech]);

  const enqueueSpeech = useCallback((eventId, text, language) => {
    if (!eventId || receivedEventIdsRef.current.has(eventId)) return;
    receivedEventIdsRef.current.add(eventId);
    if (receivedEventIdsRef.current.size > 500) {
      const oldestEventId = receivedEventIdsRef.current.values().next().value;
      receivedEventIdsRef.current.delete(oldestEventId);
    }

    speechQueueRef.current.push({ text, language });
    playNextSpeech();
  }, [playNextSpeech]);

  const refresh = useCallback(() => {
    getDisplayData().then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    setSpeechAvailable('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    getAdminSettings()
      .then((items) => {
        const nextSettings = { queueVoiceTh: '', queueVoiceEn: '', queueSpeechRate: '0.95' };
        items.forEach((item) => {
          if (item.key in nextSettings) nextSettings[item.key] = item.value;
        });
        voiceSettingsRef.current = nextSettings;
        setVoiceSettings(nextSettings);
      })
      .catch(() => {});
    refresh();
    socket.on('display:update', refresh);

    const onSettingsUpdated = (setting) => {
      if (['queueVoiceTh', 'queueVoiceEn', 'queueSpeechRate'].includes(setting.key)) {
        voiceSettingsRef.current = { ...voiceSettingsRef.current, [setting.key]: setting.value };
        setVoiceSettings(voiceSettingsRef.current);
      }
    };

    const onCalled = (q) => {
      const isEnglish = q.language === 'EN';
      enqueueSpeech(
        q.eventId,
        isEnglish ? `Now serving ${spellTicket(q.ticketNo)} at counter ${q.counterNo}` : `ขอเชิญหมายเลข ${spellTicket(q.ticketNo)} ที่ช่องบริการที่ ${q.counterNo}`,
        isEnglish ? 'EN' : 'TH'
      );
    };
    socket.on('queue:called', onCalled);
    socket.on('settings:updated', onSettingsUpdated);

    return () => {
      socket.off('display:update', refresh);
      socket.off('queue:called', onCalled);
      socket.off('settings:updated', onSettingsUpdated);
      speechQueueRef.current = [];
      isSpeakingRef.current = false;
      window.speechSynthesis?.cancel();
    };
  }, [enqueueSpeech, refresh]);

  return (
    <div className="min-h-screen bg-primary-dark text-white font-body flex flex-col" onPointerDown={enableSpeech}>
      {!speechEnabled && (
        <button
          type="button"
          onClick={enableSpeech}
          disabled={!speechAvailable}
          className="fixed bottom-6 right-6 z-20 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-primary-dark shadow-lg"
        >
          {speechAvailable ? 'เปิดเสียงเรียกคิว' : 'TV นี้ไม่รองรับเสียงพูด'}
        </button>
      )}
      <header className="flex items-center justify-between px-10 py-6 border-b border-white/10">
        <div className="bg-white rounded-xl px-4 py-2">
          <Logo page="display" className="h-10" />
        </div>
        <h1 className="font-display font-semibold text-2xl tracking-wide">
          จอแสดงคิวติดต่อธุรการ
        </h1>
        <Clock />
      </header>

      <main className="flex-1 flex">
        {/* Calling counters */}
        <div className="flex-1 p-10 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 content-start">
          {data.counters.length === 0 && <p className="text-white/40 text-sm">ยังไม่มีช่องบริการที่เปิดใช้งาน</p>}
          {data.counters.map((counter) => {
            const q = counter.currentQueue || data.calling.find((item) => item.counterNo === counter.id);
            const isEnglish = q?.language === 'EN';
            return (
              <section
                key={counter.id}
                className={`rounded-3xl p-8 text-center border-2 ${
                  q ? 'border-accent bg-white/5 calling-pulse' : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <p className="text-xs tracking-widest text-white/50 font-display mb-3">
                  {counter.name}
                </p>
                <p
                  className={`font-display font-semibold ${
                    q ? 'text-7xl text-accent' : 'text-4xl text-white/20'
                  }`}
                >
                  {q ? q.ticketNo : '—'}
                </p>
                <p className="text-sm text-white/60 mt-3">{isEnglish ? counter.service?.nameEn || counter.service?.name || 'Service not assigned' : counter.service?.name || 'ยังไม่ได้กำหนดประเภทบริการ'}</p>
                <div className="mt-6 border-t border-white/10 pt-4 text-left">
                  <p className="text-xs tracking-wide text-white/50 mb-2">{isEnglish ? 'Waiting queues' : 'คิวรอของบริการนี้'}</p>
                  {counter.waiting.length === 0 ? (
                    <p className="text-sm text-white/30">{isEnglish ? 'No waiting queues' : 'ไม่มีคิวรอ'}</p>
                  ) : (
                    <div className="space-y-2">
                      {counter.waiting.map((waitingQueue, index) => (
                        <div key={waitingQueue.id} className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2">
                          <span className="text-xs text-white/40">{index + 1}</span>
                          <span className="font-display font-medium text-accent">{waitingQueue.ticketNo}</span>
                          <span className="text-xs text-white/60 truncate ml-2">{waitingQueue.language === 'EN' ? waitingQueue.contactSubjectEn || waitingQueue.contactSubject || waitingQueue.service?.nameEn || waitingQueue.service?.name : waitingQueue.contactSubject || waitingQueue.service?.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {/* Skipped queue sidebar */}
        <aside className="w-72 bg-white/5 border-l border-white/10 p-6">
          <h2 className="font-display font-medium text-warning mb-4 text-sm tracking-wide">
            คิวที่ถูกข้าม
          </h2>
          <div className="space-y-2">
            {data.skipped.length === 0 && (
              <p className="text-white/30 text-sm">ไม่มีคิวที่ถูกข้าม</p>
            )}
            {data.skipped.map((q) => (
              <div key={q.id} className="bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
                <p className="font-display font-medium text-warning">{q.ticketNo}</p>
                <p className="text-xs text-white/50">{q.service?.name}</p>
              </div>
            ))}
          </div>
        </aside>
      </main>

      {/* Next waiting ticker */}
      <footer className="border-t border-white/10 px-10 py-5 flex items-center gap-4">
        <span className="text-xs tracking-widest text-white/50 font-display shrink-0">
          คิวถัดไป
        </span>
        <div className="flex gap-3 overflow-x-auto">
          {data.waiting.length === 0 && <span className="text-white/30 text-sm">ไม่มีคิวรอ</span>}
          {data.waiting.map((q) => (
            <span
              key={q.id}
              className="font-display font-medium bg-white/10 rounded-lg px-3 py-1.5 whitespace-nowrap"
            >
              {q.ticketNo}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}

// แปลง "A-001" ให้อ่านเป็นเสียงที่เข้าใจง่ายขึ้น เช่น "เอ ศูนย์ศูนย์หนึ่ง"
function spellTicket(ticketNo) {
  const [prefix, num] = ticketNo.split('-');
  return `${prefix} ${num}`;
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="font-display text-white/70 text-sm">
      {now.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
    </p>
  );
}
